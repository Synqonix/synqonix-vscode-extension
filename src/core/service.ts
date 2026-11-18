import { array, object, withArray } from "../api/guards";
import type {
  Activity, Backlog, Comment, CreateTask, Member, Notification, NotificationList, Priority, Project, ProjectDetail, Status, Task, TaskDetail,
  TaskGithub, TaskHit, TaskList, TimeEntry, Timer, UpdateTask, User, Workspace,
} from "../api/types";
import type { Api } from "./api";
import { branchNameFor, type Git } from "./git";
import { startStatus } from "./format";

export type { Backlog, Priority, Project, Status, Task, TaskDetail, TimeEntry, Workspace };

/** A task key or id as it appears in a URL. */
const seg = encodeURIComponent;
const ws = (workspaceId: string) => `/api/v1/workspaces/${seg(workspaceId)}`;

const TASK = object("id", "key", "title", "status");
const TASKS = withArray("items", TASK);

export interface StartWorkOptions {
  /** Folder of the repository to branch in. */
  cwd: string;
  moveToInProgress: boolean;
  assignToMe: boolean;
  /** Branch to start from; defaults to the current HEAD. */
  base?: string;
  startTimer?: boolean;
}

export interface StartWorkResult {
  branch: string;
  branchCreated: boolean;
  movedTo: string | null;
  assigned: boolean;
  timerStarted: boolean;
  task: TaskDetail;
}

/** Everything the extension asks of Synqonix, in terms of tasks rather than HTTP. */
export class TaskService {
  constructor(private readonly api: Api, private readonly git: Git) {}

  // ---------------------------------------------------------------- who and where

  me() {
    return this.api.get<User>("/api/v1/users/me", object("id", "email"));
  }

  workspaces() {
    return this.api.get<Workspace[]>("/api/v1/workspaces", array(object("id", "name")));
  }

  members(workspaceId: string) {
    return this.api.get<Member[]>(`${ws(workspaceId)}/members`, array(object("userId", "name")));
  }

  async projects(workspaceId: string): Promise<Project[]> {
    const all = await this.api.get<Project[]>(`${ws(workspaceId)}/projects`, array(object("id", "key", "name")));
    return all.filter((p) => !p.archived);
  }

  async statuses(workspaceId: string, projectId: string): Promise<Status[]> {
    const p = await this.api.get<ProjectDetail>(`${ws(workspaceId)}/projects/${seg(projectId)}`, withArray("statuses", object("id", "name", "position")));
    return [...p.statuses].sort((a, b) => a.position - b.position);
  }

  // ---------------------------------------------------------------- lists

  /** Open tasks assigned to the caller, across all projects of the workspace. */
  async myTasks(workspaceId: string): Promise<Task[]> {
    const [todo, doing] = await Promise.all(
      (["TODO", "IN_PROGRESS"] as const).map(async (statusCategory) =>
        (await this.api.get<TaskList>(`${ws(workspaceId)}/tasks`, TASKS, { query: { assignee: "me", statusCategory, excludeSubtasks: false, limit: 100 } })).items),
    );
    return [...doing, ...todo];
  }

  async sprintTasks(workspaceId: string, projectId: string): Promise<Task[]> {
    return (await this.api.get<TaskList>(`${ws(workspaceId)}/tasks`, TASKS, { query: { projectId, sprintId: "active", limit: 100 } })).items;
  }

  backlog(workspaceId: string, projectId: string) {
    return this.api.get<Backlog>(`${ws(workspaceId)}/projects/${seg(projectId)}/backlog`, object("sprints", "backlog"));
  }

  async recent(workspaceId: string): Promise<Task[]> {
    return (await this.api.get<TaskList>(`${ws(workspaceId)}/recent-tasks`, TASKS)).items;
  }

  /** Free-text search with the same filters as the web app (`assignee:me status:open`). */
  async search(workspaceId: string, q: string): Promise<TaskHit[]> {
    if (!q.trim()) return [];
    return (await this.api.get<{ tasks: TaskHit[] }>(`${ws(workspaceId)}/search`, withArray("tasks"), { query: { q, types: "tasks", limit: 20 } })).tasks;
  }

  // ---------------------------------------------------------------- one task

  task(workspaceId: string, key: string) {
    return this.api.get<TaskDetail>(`${ws(workspaceId)}/tasks/${seg(key)}`, object("id", "key", "title", "status"));
  }

  comments(workspaceId: string, key: string) {
    return this.api.get<Comment[]>(`${ws(workspaceId)}/tasks/${seg(key)}/comments`, array(object("id", "body")));
  }

  activity(workspaceId: string, key: string) {
    return this.api.get<Activity[]>(`${ws(workspaceId)}/tasks/${seg(key)}/activity`, array(object("id", "type")), { query: { limit: 30 } });
  }

  github(workspaceId: string, key: string) {
    return this.api.get<TaskGithub>(`${ws(workspaceId)}/tasks/${seg(key)}/github`, object("branches", "pullRequests", "suggestedBranch"));
  }

  // ---------------------------------------------------------------- changes

  async create(workspaceId: string, projectId: string, input: { title: string; type?: Task["type"]; description?: string; assignToMe?: boolean }): Promise<TaskDetail> {
    const me = input.assignToMe ? (await this.me()).id : undefined;
    const body: CreateTask = { title: input.title, ...(input.type ? { type: input.type } : {}), ...(input.description ? { description: input.description } : {}), ...(me ? { assigneeIds: [me] } : {}) };
    return this.api.post<TaskDetail>(`${ws(workspaceId)}/projects/${seg(projectId)}/tasks`, TASK, { body });
  }

  private patch(workspaceId: string, key: string, body: UpdateTask) {
    return this.api.patch<TaskDetail>(`${ws(workspaceId)}/tasks/${seg(key)}`, TASK, { body });
  }

  transition(workspaceId: string, key: string, statusId: string) { return this.patch(workspaceId, key, { statusId }); }
  setPriority(workspaceId: string, key: string, priority: Priority) { return this.patch(workspaceId, key, { priority }); }
  setAssignees(workspaceId: string, key: string, assigneeIds: string[]) { return this.patch(workspaceId, key, { assigneeIds }); }

  async assignToMe(workspaceId: string, key: string): Promise<TaskDetail> {
    const [me, task] = await Promise.all([this.me(), this.task(workspaceId, key)]);
    return task.assignees.some((a) => a.userId === me.id) ? task : this.setAssignees(workspaceId, key, [...task.assignees.map((a) => a.userId), me.id]);
  }

  comment(workspaceId: string, key: string, body: string) {
    return this.api.post<Comment>(`${ws(workspaceId)}/tasks/${seg(key)}/comments`, object("id", "body"), { body: { body } });
  }

  // ---------------------------------------------------------------- time

  async timer(workspaceId: string): Promise<TimeEntry | null> {
    return (await this.api.get<Timer>(`${ws(workspaceId)}/time/timer`, object("entry"))).entry;
  }

  async startTimer(workspaceId: string, key: string): Promise<TimeEntry | null> {
    return (await this.api.post<Timer>(`${ws(workspaceId)}/time/timer/start`, object("entry"), { body: { taskRef: key } })).entry;
  }

  /** Stops the running timer; the finished entry, or null if none was running (or it ran under a minute). */
  async stopTimer(workspaceId: string): Promise<TimeEntry | null> {
    return (await this.api.post<Timer>(`${ws(workspaceId)}/time/timer/stop`, object("entry"))).entry;
  }

  // ---------------------------------------------------------------- inbox

  async unreadNotifications(): Promise<Notification[]> {
    return (await this.api.get<NotificationList>("/api/v1/notifications", withArray("items"), { query: { unread: true, limit: 30 } })).items;
  }

  // ---------------------------------------------------------------- start working

  /**
   * "Start task": branch `syn-12-short-title` in the repository (created, or switched to when it
   * already exists), then — only if the branch worked — assign you, move the task to the first
   * in-progress status and start the timer, as asked.
   */
  async startWork(workspaceId: string, key: string, opts: StartWorkOptions): Promise<StartWorkResult> {
    let task = await this.task(workspaceId, key);
    const branch = branchNameFor(task.key, task.title);
    const branchCreated = await this.git.checkoutOrCreate(opts.cwd, branch, opts.base);

    let assigned = false;
    if (opts.assignToMe) {
      const me = await this.me();
      if (!task.assignees.some((a) => a.userId === me.id)) {
        task = await this.setAssignees(workspaceId, key, [...task.assignees.map((a) => a.userId), me.id]);
        assigned = true;
      }
    }
    let movedTo: string | null = null;
    if (opts.moveToInProgress) {
      const next = startStatus(await this.statuses(workspaceId, task.projectId), task.status);
      if (next) {
        task = await this.transition(workspaceId, key, next.id);
        movedTo = next.name;
      }
    }
    let timerStarted = false;
    if (opts.startTimer) timerStarted = (await this.startTimer(workspaceId, key)) !== null;
    return { branch, branchCreated, movedTo, assigned, timerStarted, task };
  }
}
