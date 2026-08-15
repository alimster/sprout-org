# Org Chart Hub

Target data model

Give this to the AI up front. Everything else hangs off it.

profiles

Extends the auth user. One row per employee.




Field

Type

Notes

id

uuid

FK → auth user id

full_name

text

title

text

job title

department

text

manager_id

uuid

self-referencing FK → profiles.id — this is what powers the org chart

email

text

avatar_url

text

nullable

is_active

boolean

default true — for people who leave

created_at

timestamp

user_roles

Deliberately a separate table. See the security note below.




Field

Type

Notes

user_id

uuid

FK → profiles.id

role

enum

admin | member

invitations

The allowlist. Nobody can create an account unless their email is in here.




Field

Type

Notes

id

uuid

email

text

unique, lowercased

full_name

text

pre-filled so the profile is populated on signup

title

text

nullable

department

text

nullable

manager_email

text

nullable — text, not a FK. See note below.

role

enum

admin | member, default member

status

enum

pending | accepted | revoked

invited_by

uuid

FK → profiles.id

accepted_at

timestamp

nullable

created_at

timestamp




Why manager_email is text and not a foreign key: you want to be able to upload your whole org chart before anyone has signed up. At that moment none of those managers have profile rows yet, so a FK would fail. Storing the email lets you resolve it to a real manager_id later, as each person accepts.

documents

Field

Type

Notes

id

uuid

name

text

file_path

text

reference into storage bucket

uploaded_by

uuid

FK → profiles.id

assigned_signer_id

uuid

FK → profiles.id, nullable

status

enum

pending | signed | rejected

signed_at

timestamp

nullable

notes

text

nullable

created_at

timestamp

tasks

Field

Type

Notes

id

uuid

title

text

description

text

priority

enum

low | medium | high

status

enum

unassigned | assigned | accepted | declined | in_progress | completed

created_by

uuid

FK → profiles.id

assignee_id

uuid

FK → profiles.id, nullable

due_date

date

nullable

completed_at

timestamp

nullable

created_at

timestamp

activity_log

One audit table covering both docs and tasks. Cheaper than two.




Field

Type

Notes

id

uuid

entity_type

enum

task | document

entity_id

uuid

actor_id

uuid

FK → profiles.id

action

text

e.g. assigned, accepted, completed, signed

note

text

nullable

created_at

timestamp








Phase 0 — Foundation (auth, profiles, access control)

Goal: Nobody can see anything without logging in. Roles work. No features yet.




Do not skip this. Do not build a feature first "just to see it working."

Prompt

Set up the foundation for a multi-user internal company app. Do not build any




features yet — only auth, the database schema, and access rules.




1. Add email/password authentication with sign-up, login, and logout.




2. Create a `profiles` table with: id (linked to the auth user), full_name,




   title, department, manager_id (a self-referencing foreign key to




   profiles.id, nullable), email, avatar_url (nullable), is_active (boolean,




   default true), created_at.




   Automatically create a profile row whenever a new user signs up.




3. Create a SEPARATE `user_roles` table with user_id and a role enum of




   'admin' or 'member'. Do NOT put the role column on the profiles table.




   Create a security-definer function to check a user's role, and use that




   function inside policies rather than querying user_roles directly.




4. Create an `invitations` table: id, email (unique, stored lowercased),




   full_name, title (nullable), department (nullable), manager_email (plain




   text, nullable — NOT a foreign key), role enum ('admin'/'member',




   default 'member'), status enum ('pending'/'accepted'/'revoked'),




   invited_by, accepted_at (nullable), created_at.




5. Signup must be invite-only. When someone tries to sign up:




   - Look up their email in `invitations` with status 'pending'.




   - If there is no match, block the signup with a clear message telling




     them to ask an admin for an invite. Do not create an auth user.




   - If there is a match, create the account, create their profile




     pre-filled with full_name, title, and department from the invitation,




     assign the role from the invitation into user_roles, and set the




     invitation status to 'accepted' with accepted_at.




6. After each accepted invitation, run a manager-resolution step:




   - For the new profile, if their invitation had a manager_email and a




     profile now exists with that email, set their manager_id to it.




   - Also check every existing profile whose manager_id is still null but




     whose invitation had a manager_email matching the NEW user's email,




     and set their manager_id to the new user.




   This lets an org chart uploaded in advance link itself up as people join,




   in any order.




7. Admin-only "People" management screen:




   - Table of all invitations with email, name, role, status, and date.




   - Add a single person by entering email, name, title, department,




     manager_email, and role.




   - Bulk import: upload a CSV with columns email, full_name, title,




     department, manager_email, role. Validate every row before inserting




     anything — show which rows are invalid and why, and do not do a




     partial import. Skip duplicates against existing invitations.




   - Revoke a pending invitation (set status 'revoked').




   - Re-invite someone whose invitation was revoked.




8. Enable row-level security:




   - Any logged-in user can read all profiles.




   - A user can update only their own profile.




   - Only admins can insert or update rows in user_roles.




   - Only admins can change another user's profile or set is_active.




   - Only admins can read, create, or modify invitations. A signing-up user




     is not yet logged in, so the invitation lookup during signup must run




     through a security-definer function, not a client-side query.




9. Create a simple placeholder home page showing the logged-in user's name




   and role, and nothing else.

Bootstrapping the first admin

There's a chicken-and-egg problem: only an admin can send invitations, but there are no users yet. Handle it this way:




Sign up your own account first. It will be blocked, because no invitation exists.

In the database, manually insert one invitation row for your own email with role = 'admin' and status = 'pending'.

Sign up again — you'll come through as admin, and you can invite everyone else from the UI.




Do not ask for "the first user to sign up automatically becomes admin." If the app is live for even a few minutes before you sign up, a stranger who finds the URL becomes the owner of your company's data.

Acceptance test

Try signing up with an email that has no invitation — it must be rejected, and no auth user should be created

Bootstrap yourself as admin per the steps above

Invite a second person, sign up as them in incognito, and confirm their profile is pre-filled with the name/title/department from the invite

Confirm the second (member) account cannot see the People management screen

Upload a CSV with one deliberately broken row and confirm the entire import is rejected, not just that row

Invite person A with manager_email pointing at person B who hasn't signed up yet. Have B sign up afterwards, then confirm A's manager_id got filled in automatically

Common failures

role ends up on profiles. If a user can update their own profile row, they can promote themselves to admin. Re-prompt: "Move role out of profiles into the separate user_roles table and update all policies."

The invitation check runs client-side. If the signup form queries invitations from the browser and then decides whether to proceed, anyone can bypass it. It must be enforced server-side.

CSV import does partial writes. A half-imported org chart is worse than a failed one. Validate everything first, then insert.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/963c59d7-5ebf-4d83-9ff8-2c706b4e6755).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
