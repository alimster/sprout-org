CREATE TYPE public.document_status AS ENUM ('pending', 'signed', 'rejected');

CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  file_path text NOT NULL UNIQUE,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_signer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.document_status NOT NULL DEFAULT 'pending',
  signed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documents_uploaded_by_idx ON public.documents(uploaded_by);
CREATE INDEX documents_assigned_signer_idx ON public.documents(assigned_signer_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_read_document(_doc_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = _doc_id
      AND (d.uploaded_by = _user_id OR d.assigned_signer_id = _user_id OR public.has_role(_user_id, 'admin'))
  )
$$;

CREATE OR REPLACE FUNCTION public.can_read_document_path(_path text, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.file_path = _path
      AND (d.uploaded_by = _user_id OR d.assigned_signer_id = _user_id OR public.has_role(_user_id, 'admin'))
  )
$$;

CREATE OR REPLACE FUNCTION public.can_delete_document_path(_path text, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.file_path = _path
      AND (d.uploaded_by = _user_id OR public.has_role(_user_id, 'admin'))
  )
$$;

CREATE POLICY "Readers can view documents" ON public.documents
FOR SELECT TO authenticated
USING (
  uploaded_by = auth.uid()
  OR assigned_signer_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Users can upload documents" ON public.documents
FOR INSERT TO authenticated
WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Signer or admin can update documents" ON public.documents
FOR UPDATE TO authenticated
USING (assigned_signer_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (assigned_signer_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Uploader or admin can delete documents" ON public.documents
FOR DELETE TO authenticated
USING (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- keep uploader-owned fields immutable and validate status transitions
CREATE OR REPLACE FUNCTION public.guard_document_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();

  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.file_path IS DISTINCT FROM OLD.file_path
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.assigned_signer_id IS DISTINCT FROM OLD.assigned_signer_id
     OR NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'Only the document status can be changed';
  END IF;

  IF NEW.status = 'rejected' AND (NEW.notes IS NULL OR btrim(NEW.notes) = '') THEN
    RAISE EXCEPTION 'A reason is required when rejecting a document';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_guard_update BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.guard_document_update();

-- activity log
CREATE TABLE public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activity_log_entity_idx ON public.activity_log(entity_type, entity_id);

GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins or actor can read activity" ON public.activity_log
FOR SELECT TO authenticated
USING (actor_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can write their own activity" ON public.activity_log
FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid());

-- storage policies mirror document row access
CREATE POLICY "Upload own documents folder" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Read documents with row access" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.can_read_document_path(name, auth.uid())
  )
);

CREATE POLICY "Delete documents with row access" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.can_delete_document_path(name, auth.uid())
  )
);