-- 1. Cycle prevention for manager_id
CREATE OR REPLACE FUNCTION public.prevent_manager_cycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cursor uuid;
  _hops int := 0;
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.manager_id = NEW.id THEN
    RAISE EXCEPTION 'A person cannot be their own manager';
  END IF;

  -- Walk up from the proposed manager. If we reach NEW.id, this creates a loop.
  _cursor := NEW.manager_id;
  WHILE _cursor IS NOT NULL LOOP
    _hops := _hops + 1;
    IF _hops > 200 THEN
      RAISE EXCEPTION 'Reporting chain is too deep or already contains a loop';
    END IF;
    IF _cursor = NEW.id THEN
      RAISE EXCEPTION 'That change would create a circular reporting line';
    END IF;
    SELECT manager_id INTO _cursor FROM public.profiles WHERE id = _cursor;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_manager_cycle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_prevent_manager_cycle ON public.profiles;
CREATE TRIGGER profiles_prevent_manager_cycle
BEFORE INSERT OR UPDATE OF manager_id, id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_manager_cycle();

-- 2. Non-admins may only change their own title and department
CREATE OR REPLACE FUNCTION public.guard_profile_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.full_name IS DISTINCT FROM OLD.full_name
     OR NEW.manager_id IS DISTINCT FROM OLD.manager_id
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'You can only change your own job title and department';
  END IF;

  RETURN NEW;
END;
$$;
