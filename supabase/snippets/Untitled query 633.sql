CREATE POLICY "users_read_own_profile" ON profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
  