CREATE TYPE public.task_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE public.task_status AS ENUM ('unassigned', 'assigned', 'accepted', 'declined', 'in_progress', 'completed');

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  priority public.task_priority NOT NULL DEFAULT 'medium',
  status public.task_status NOT NULL DEFAULT 'unassigned',
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  assignee_id uuid REFERENCES public.profiles(id),
  due_date date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tasks_status_idx ON public.tasks (status, created_at DESC);
CREATE INDEX tasks_assignee_idx ON public.tasks (assignee_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read tasks"
  ON public.tasks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create tasks"
  ON public.tasks FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "Assignee creator or admin can update tasks"
  ON public.tasks FOR UPDATE TO authenticated
  USING (assignee_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (assignee_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can claim an unassigned task"
  ON public.tasks FOR UPDATE TO authenticated
  USING (status = 'unassigned')
  WITH CHECK (assignee_id IS NOT NULL AND status = 'assigned');

CREATE POLICY "Creator or admin can delete tasks"
  ON public.tasks FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.guard_task_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.id := OLD.id;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;

  IF NEW.status = 'completed' THEN
    IF OLD.status <> 'completed' OR NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;

  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') OR OLD.created_by = auth.uid() THEN
    RETURN NEW;
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    RAISE EXCEPTION 'Only the task creator or an admin can edit task details';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_guard_update
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_update();

CREATE POLICY "Authenticated users can read task activity"
  ON public.activity_log FOR SELECT TO authenticated
  USING (entity_type = 'task');