CREATE POLICY "Readers can read document activity"
ON public.activity_log
FOR SELECT
TO authenticated
USING (entity_type = 'document' AND entity_id IS NOT NULL AND public.can_read_document(entity_id, auth.uid()));