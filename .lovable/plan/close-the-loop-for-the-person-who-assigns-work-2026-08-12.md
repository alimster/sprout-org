# Close the loop for the person who assigns work

## How it works today

1. Anyone signed in can create a task and assign it to a team member. Status becomes "Assigned" and the change is written to the activity log.
2. The assignee sees it at /work under "My work", grouped by status, with Accept, Start, Complete, and Decline (reason required).
3. The person who raised the task has no dedicated place to watch it. The dashboard card "My open requests" counts tasks they created that aren't finished and lists a few titles, and the completion shows up in the recent activity feed. There is no list of tasks they raised, no completed history, and no notification.

## What to add

### 1. "I raised" tab on /work
A third tab next to "Work needed" and "My work" listing every task where the signed-in user is the creator, grouped by status in the same order used for My work (assigned, accepted, in progress, completed, declined). Each row shows title, priority, assignee name, due date, and last-updated time, and opens the existing task detail dialog with its activity timeline.

### 2. Highlight what changed since you last looked
In the "I raised" tab, surface two callouts at the top:
- Completed and awaiting your review (tasks you created that reached "completed")
- Declined back to the pool (tasks you created that an assignee declined, with the reason)

This makes "he finished it" and "he refused it" both visible without hunting through the feed.

### 3. Dashboard card upgrade
Change the "My open requests" card into a fuller requests card: open count, plus a "recently completed" count with a link into the new tab. Keep the existing error and loading behaviour.

## Not included (say the word if you want them)
- Email or in-app notifications on completion or decline
- A separate acknowledge/close step where the creator confirms the work was actually done (would need a new task status and a schema change)

## Technical notes
- Frontend only. No schema, RLS, or policy changes: all signed-in users can already read all tasks, and `created_by` is already on the row.
- Reuse `MY_WORK_STATUSES` grouping, `sortByPriorityThenNewest`, and `TaskDetailDialog` from the existing Work page rather than adding parallel logic.
- Existing queries on /work already fetch all tasks plus profiles, so the new tab needs no extra fetching.
