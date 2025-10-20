-- This policy allows admins to update user passwords
CREATE POLICY "Admins can update user passwords" ON auth.users
FOR UPDATE
TO authenticated
WITH CHECK (auth.role() = 'service_role');
