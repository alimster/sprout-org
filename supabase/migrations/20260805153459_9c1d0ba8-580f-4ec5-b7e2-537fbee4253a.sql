REVOKE ALL ON FUNCTION public.can_read_document(uuid, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_document_path(text, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.can_delete_document_path(text, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_document_update() FROM anon, authenticated;