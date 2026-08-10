-- 1. Lock down SECURITY DEFINER functions -------------------------------------
REVOKE ALL ON FUNCTION public.guard_task_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_document_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_profile_self_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_manager_cycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_managers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_pending_invitation(text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.can_read_document(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_document_path(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_delete_document_path(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_read_document(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_document_path(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_document_path(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- 2. Profiles: server-side field validation ------------------------------------
CREATE OR REPLACE FUNCTION public.validate_profile_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.full_name := btrim(coalesce(NEW.full_name, ''));
  NEW.title := nullif(btrim(coalesce(NEW.title, '')), '');
  NEW.department := nullif(btrim(coalesce(NEW.department, '')), '');
  NEW.email := lower(btrim(coalesce(NEW.email, '')));

  IF length(NEW.full_name) > 120 THEN
    RAISE EXCEPTION 'Name must be 120 characters or fewer';
  END IF;
  IF length(coalesce(NEW.title, '')) > 120 THEN
    RAISE EXCEPTION 'Job title must be 120 characters or fewer';
  END IF;
  IF length(coalesce(NEW.department, '')) > 120 THEN
    RAISE EXCEPTION 'Department must be 120 characters or fewer';
  END IF;
  IF NEW.email = '' OR NEW.email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]+$' OR length(NEW.email) > 255 THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_validate ON public.profiles;
CREATE TRIGGER profiles_validate
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_row();
REVOKE ALL ON FUNCTION public.validate_profile_row() FROM PUBLIC, anon, authenticated;

-- 3. Invitations: server-side field validation ---------------------------------
CREATE OR REPLACE FUNCTION public.validate_invitation_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.email := lower(btrim(coalesce(NEW.email, '')));
  NEW.full_name := btrim(coalesce(NEW.full_name, ''));
  NEW.title := nullif(btrim(coalesce(NEW.title, '')), '');
  NEW.department := nullif(btrim(coalesce(NEW.department, '')), '');
  NEW.manager_email := nullif(lower(btrim(coalesce(NEW.manager_email, ''))), '');

  IF NEW.email = '' OR NEW.email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]+$' OR length(NEW.email) > 255 THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;
  IF NEW.full_name = '' OR length(NEW.full_name) > 120 THEN
    RAISE EXCEPTION 'Full name is required and must be 120 characters or fewer';
  END IF;
  IF length(coalesce(NEW.title, '')) > 120 OR length(coalesce(NEW.department, '')) > 120 THEN
    RAISE EXCEPTION 'Job title and department must be 120 characters or fewer';
  END IF;
  IF NEW.manager_email IS NOT NULL THEN
    IF NEW.manager_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]+$' OR length(NEW.manager_email) > 255 THEN
      RAISE EXCEPTION 'The manager email address is not valid';
    END IF;
    IF NEW.manager_email = NEW.email THEN
      RAISE EXCEPTION 'A person cannot be their own manager';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invitations_validate ON public.invitations;
CREATE TRIGGER invitations_validate
  BEFORE INSERT OR UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.validate_invitation_row();
REVOKE ALL ON FUNCTION public.validate_invitation_row() FROM PUBLIC, anon, authenticated;

-- 4. Tasks: insert validation ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_task_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.title := btrim(coalesce(NEW.title, ''));
  NEW.description := nullif(btrim(coalesce(NEW.description, '')), '');

  IF NEW.title = '' THEN
    RAISE EXCEPTION 'A task needs a title';
  END IF;
  IF length(NEW.title) > 160 THEN
    RAISE EXCEPTION 'Task title must be 160 characters or fewer';
  END IF;
  IF length(coalesce(NEW.description, '')) > 2000 THEN
    RAISE EXCEPTION 'Task description must be 2000 characters or fewer';
  END IF;
  IF NEW.due_date IS NOT NULL
     AND (NEW.due_date < date '2000-01-01' OR NEW.due_date > (current_date + interval '10 years')) THEN
    RAISE EXCEPTION 'That due date is not a sensible date';
  END IF;
  IF NEW.assignee_id IS NULL AND NEW.status <> 'unassigned' THEN
    RAISE EXCEPTION 'A task with no assignee must sit in the work pool';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_validate ON public.tasks;
CREATE TRIGGER tasks_validate
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.validate_task_row();
REVOKE ALL ON FUNCTION public.validate_task_row() FROM PUBLIC, anon, authenticated;

-- 5. Tasks: harden the update guard --------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_task_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _privileged boolean;
BEGIN
  NEW.updated_at := now();
  NEW.id := OLD.id;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;

  NEW.title := btrim(coalesce(NEW.title, ''));
  NEW.description := nullif(btrim(coalesce(NEW.description, '')), '');
  IF NEW.title = '' OR length(NEW.title) > 160 THEN
    RAISE EXCEPTION 'A task needs a title of 160 characters or fewer';
  END IF;
  IF length(coalesce(NEW.description, '')) > 2000 THEN
    RAISE EXCEPTION 'Task description must be 2000 characters or fewer';
  END IF;
  IF NEW.due_date IS NOT NULL
     AND (NEW.due_date < date '2000-01-01' OR NEW.due_date > (current_date + interval '10 years')) THEN
    RAISE EXCEPTION 'That due date is not a sensible date';
  END IF;

  IF NEW.status = 'completed' THEN
    IF OLD.status <> 'completed' OR NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;

  IF NEW.assignee_id IS NULL AND NEW.status <> 'unassigned' THEN
    RAISE EXCEPTION 'A task with no assignee must return to the work pool';
  END IF;
  IF NEW.assignee_id IS NOT NULL AND NEW.status = 'unassigned' THEN
    RAISE EXCEPTION 'An assigned task cannot sit in the work pool';
  END IF;

  _privileged := auth.uid() IS NULL
    OR public.has_role(auth.uid(), 'admin')
    OR OLD.created_by = auth.uid();

  IF _privileged THEN
    RETURN NEW;
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    RAISE EXCEPTION 'Only the task creator or an admin can edit task details';
  END IF;

  -- Handing an already-assigned task to a different person is a creator/admin action.
  IF OLD.assignee_id IS NOT NULL
     AND NEW.assignee_id IS NOT NULL
     AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    RAISE EXCEPTION 'Only the task creator or an admin can reassign this task';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_task_update() FROM PUBLIC, anon, authenticated;

-- 6. Documents: insert validation + path ownership ------------------------------
CREATE OR REPLACE FUNCTION public.validate_document_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.name := btrim(coalesce(NEW.name, ''));
  NEW.file_path := btrim(coalesce(NEW.file_path, ''));
  NEW.notes := nullif(btrim(coalesce(NEW.notes, '')), '');

  IF NEW.name = '' THEN
    RAISE EXCEPTION 'Give the document a name';
  END IF;
  IF length(NEW.name) > 160 THEN
    RAISE EXCEPTION 'Document name must be 160 characters or fewer';
  END IF;
  IF length(coalesce(NEW.notes, '')) > 1000 THEN
    RAISE EXCEPTION 'Notes must be 1000 characters or fewer';
  END IF;
  IF NEW.file_path = '' OR position('/' in NEW.file_path) = 0 THEN
    RAISE EXCEPTION 'The stored file location is not valid';
  END IF;

  -- A document may only point at a file inside the uploader's own storage folder.
  IF split_part(NEW.file_path, '/', 1) <> NEW.uploaded_by::text THEN
    RAISE EXCEPTION 'A document must reference a file in your own folder';
  END IF;
  IF auth.uid() IS NOT NULL AND NEW.uploaded_by <> auth.uid() THEN
    RAISE EXCEPTION 'You can only upload documents as yourself';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_validate ON public.documents;
CREATE TRIGGER documents_validate
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.validate_document_row();
REVOKE ALL ON FUNCTION public.validate_document_row() FROM PUBLIC, anon, authenticated;

-- 7. Documents: harden the update guard ----------------------------------------
CREATE OR REPLACE FUNCTION public.guard_document_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.notes := nullif(btrim(coalesce(NEW.notes, '')), '');

  IF length(coalesce(NEW.notes, '')) > 1000 THEN
    RAISE EXCEPTION 'The reason must be 1000 characters or fewer';
  END IF;

  IF NEW.status = 'rejected' AND NEW.notes IS NULL THEN
    RAISE EXCEPTION 'A reason is required when rejecting a document';
  END IF;

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

  -- A decision is final: it cannot be quietly rewritten later.
  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'This document has already been decided';
  END IF;
  IF OLD.status <> 'pending' AND NEW.notes IS DISTINCT FROM OLD.notes THEN
    RAISE EXCEPTION 'This document has already been decided';
  END IF;

  IF NEW.status = 'signed' AND NEW.signed_at IS NULL THEN
    NEW.signed_at := now();
  END IF;
  IF NEW.status <> 'signed' THEN
    NEW.signed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_document_update() FROM PUBLIC, anon, authenticated;

-- 8. Activity log: entries must reference something the actor can see -----------
CREATE OR REPLACE FUNCTION public.validate_activity_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.action := btrim(coalesce(NEW.action, ''));
  NEW.detail := nullif(btrim(coalesce(NEW.detail, '')), '');

  IF NEW.entity_type NOT IN ('task', 'document') THEN
    RAISE EXCEPTION 'Activity must relate to a task or a document';
  END IF;
  IF NEW.entity_id IS NULL THEN
    RAISE EXCEPTION 'Activity must reference a specific record';
  END IF;
  IF length(coalesce(NEW.detail, '')) > 1000 THEN
    RAISE EXCEPTION 'The note must be 1000 characters or fewer';
  END IF;

  IF NEW.entity_type = 'task' THEN
    IF NEW.action NOT IN ('created', 'assigned', 'accepted', 'declined', 'in_progress', 'completed') THEN
      RAISE EXCEPTION 'That is not a recognised task action';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = NEW.entity_id) THEN
      RAISE EXCEPTION 'That task does not exist';
    END IF;
  ELSE
    IF NEW.action NOT IN ('uploaded', 'signed', 'rejected') THEN
      RAISE EXCEPTION 'That is not a recognised document action';
    END IF;
    IF auth.uid() IS NOT NULL AND NOT public.can_read_document(NEW.entity_id, auth.uid()) THEN
      RAISE EXCEPTION 'You do not have access to that document';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activity_log_validate ON public.activity_log;
CREATE TRIGGER activity_log_validate
  BEFORE INSERT ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.validate_activity_row();
REVOKE ALL ON FUNCTION public.validate_activity_row() FROM PUBLIC, anon, authenticated;