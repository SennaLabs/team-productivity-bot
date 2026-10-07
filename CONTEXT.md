# Team Productivity

Shared language for Slack-based daily scheduling and requests for help.

## Language

**Slack Channel**:
A Slack conversation identified by its immutable Slack channel ID. It owns its settings and submission history even if its display name changes.

**Channel Settings**:
Configuration that applies to one Slack Channel. The first setting is the Daily Time Range.

**Daily Time Range**:
The default start and end times shown when a member opens the Daily modal for a Slack Channel.

**Daily Submission**:
The current Daily time range, plus an optional note, for one calendar date in a Slack Channel. A Slack Channel has at most one Daily Submission per date; submitting again replaces that date's current values.

**Issue Submission**:
A request for help created by one Slack member in a Slack Channel and directed to zero or more Asked Members.
_Avoid_: Issue Log, Blocking issue (it reads like the Issue's own *Blocking* field)

**Issue Thread**:
Any Slack message that a member picks to collect Issue Submissions as thread replies instead of new channel messages. Members post it themselves, usually as a dated "📌 Blocking Issues" header, and it is not related to the Daily Submission.
_Avoid_: Daily parent message
_Added_: 2026-10-07

**Issue Creator**:
The Slack member, or the Company Member on the dashboard, who submits an Issue Submission.
_Avoid_: Owner, submitter

**Channel Member**:
A person who was in a Slack Channel at its last member sync. Only Channel Members can be picked as Asked Members on the dashboard; in Slack, anyone in the workspace can be asked.
_Avoid_: Project member, team member
_Added_: 2026-10-07

**Asked Member**:
A Slack member whose help is requested in an Issue Submission.
_Avoid_: Assignee

**Company Member**:
A person with a verified Google identity whose email belongs to the approved company domain. Only Company Members may access the dashboard and its data APIs.
_Avoid_: Google user, dashboard user

**PR Review Request**:
A request, created by one Slack member in a Slack Channel, for one or more Reviewers to review a pull request.
_Avoid_: PR post, PR message
_Added_: 2026-10-05

**Scheduled PR Review Request**:
A PR Review Request that its creator set to post at a later time and that has not posted yet. Only its creator can cancel it; once it posts it is an ordinary PR Review Request and can no longer be cancelled, only deleted.
_Avoid_: Scheduled message, scheduleMessage
_Added_: 2026-10-05
