CREATE OR REPLACE FUNCTION public.can_read_document(_doc_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND _user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = _doc_id
      AND (d.uploaded_by = _user_id OR d.assigned_signer_id = _user_id OR public.has_role(_user_id, 'admin'))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_document_path(_path text, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND _user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.file_path = _path
      AND (d.uploaded_by = _user_id OR d.assigned_signer_id = _user_id OR public.has_role(_user_id, 'admin'))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_delete_document_path(_path text, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND _user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.file_path = _path
      AND (d.uploaded_by = _user_id OR public.has_role(_user_id, 'admin'))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION public.can_read_document(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_document_path(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_delete_document_path(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_document(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_document_path(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_document_path(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;