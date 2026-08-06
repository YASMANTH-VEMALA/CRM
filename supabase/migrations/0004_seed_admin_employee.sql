-- Links the real Supabase Auth admin user (created via the Auth Admin API)
-- to its employees record. branch_id null = all-branch access; approval_limit
-- null = unlimited, matching "Administrator" in the former mock data.
insert into employees (auth_user_id, full_name, username, email, role, branch_id, approval_limit, status)
values (
  'c1ab760c-e4dd-4bb3-a240-2ce92f5467cc',
  'Admin Mars',
  'admin',
  'admin@marspharmacy.com',
  'administrator',
  null,
  null,
  'active'
);
