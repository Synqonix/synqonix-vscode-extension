/**
 * What the extension reads from the Synqonix API, written by hand. Only the endpoints and fields
 * the extension actually uses are described; anything else a (newer) server adds is ignored.
 * The e2e tests (`npm run test:e2e`) are the contract check against a real server.
 */

export type TaskType = "STORY" | "BUG" | "TASK" | "EPIC" | "SUBTASK";
export type Priority = "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type StatusCategory = "TODO" | "IN_PROGRESS" | "DONE";
export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export interface User { id: string; email: string; name: string }

export interface Workspace { id: string; name: string; slug: string; role: WorkspaceRole }

export interface Member { userId: string; name: string; email: string; role: WorkspaceRole }

export interface Project { id: string; key: string; name: string; archived: boolean }

export interface Status { id: string; name: string; category: StatusCategory; color: string; position: number }

export interface ProjectDetail extends Project { statuses: Status[] }

export interface TaskStatus { id: string; name: string; category: StatusCategory; color: string }
export interface TaskUser { userId: string; name: string }
export interface TaskLabel { id: string; name: string; color: string }
export interface SprintRef { id: string; name: string; state: "PLANNED" | "ACTIVE" | "COMPLETED" }
export interface NamedRef { id: string; name: string }
export interface TaskRef { id: string; key: string; title: string; type: TaskType; status: TaskStatus }

/** A task as it appears in lists. */
export interface Task {
  id: string;
  key: string;
  number: number;
  projectId: string;
  projectKey: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  assignees: TaskUser[];
  labels: TaskLabel[];
  sprint: SprintRef | null;
  estimate: number | null;
  timeEstimateMinutes: number | null;
  timeSpentMinutes: number;
  dueDate: string | null;
  parentId: string | null;
  subtaskCount: number;
  subtaskDoneCount: number;
  commentCount: number;
  updatedAt: string;
}

export interface ChecklistItem { id: string; text: string; done: boolean }
export interface Checklist { id: string; title: string; items: ChecklistItem[] }

export interface TaskDetail extends Task {
  checklists: Checklist[];
  description: string | null;
  acceptanceCriteria: string | null;
  parent: TaskRef | null;
  subtasks: Task[];
  canEdit: boolean;
}

export interface TaskList { items: Task[] }

export interface TaskHit { id: string; key: string; title: string; type: TaskType; status: TaskStatus; projectId: string; snippet: string | null }

export interface Sprint { id: string; name: string; state: "PLANNED" | "ACTIVE" | "COMPLETED"; goal: string | null; startDate: string | null; endDate: string | null }
export interface Backlog {
  sprints: { sprint: Sprint; tasks: Task[] }[];
  backlog: { tasks: Task[]; total: number };
}

export interface Comment { id: string; authorId: string | null; body: string; edited: boolean; createdAt: string }

export interface Activity {
  id: string;
  actorId: string | null;
  type: string;
  field: string | null;
  from: unknown;
  to: unknown;
  createdAt: string;
}

export interface GithubRepo { id: string; fullName: string; defaultBranch: string }
export interface GithubBranch { id: string; repo: string; name: string; url: string; deleted: boolean }
export interface GithubCommit { sha: string; repo: string; message: string; url: string; authorLogin: string | null; authorName: string | null; committedAt: string }
export interface GithubPullRequest {
  id: string; repo: string; number: number; title: string; state: "OPEN" | "CLOSED" | "MERGED"; draft: boolean; url: string;
  authorLogin: string; headBranch: string; baseBranch: string; reviewState: "COMMENTED" | "APPROVED" | "CHANGES_REQUESTED" | null;
  ci: "PENDING" | "SUCCESS" | "FAILURE" | null;
}
export interface GithubIssue { id: string; repo: string; number: number; title: string; state: "OPEN" | "CLOSED"; url: string }
export interface TaskGithub {
  repos: GithubRepo[];
  suggestedBranch: string;
  branches: GithubBranch[];
  commits: GithubCommit[];
  pullRequests: GithubPullRequest[];
  issues: GithubIssue[];
}

export interface TimeEntry {
  id: string; taskId: string; taskKey: string; taskTitle: string; userId: string; userName: string;
  startedAt: string; endedAt: string | null; minutes: number; running: boolean; note: string | null;
}
export interface Timer { entry: TimeEntry | null }

export type NotificationType =
  | "ASSIGNED" | "MENTIONED" | "COMMENTED" | "STATUS_CHANGED" | "DUE_SOON" | "OVERDUE" | "SPRINT_STARTED" | "SPRINT_COMPLETED"
  | "PR_OPENED" | "PR_MERGED" | "CI_FAILED" | "CHAT_MENTION";
export interface Notification {
  id: string; type: NotificationType; workspaceId: string; projectId: string | null; title: string; body: string | null;
  taskKey: string | null; url: string; read: boolean; surfacedAt: string;
}
export interface NotificationList { items: Notification[] }

export interface UpdateTask {
  statusId?: string;
  priority?: Priority;
  assigneeIds?: string[];
}

export interface CreateTask {
  title: string;
  type?: TaskType;
  description?: string;
  assigneeIds?: string[];
}
