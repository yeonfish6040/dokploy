import { db } from "@dokploy/server/db";
import {
	deployApplication,
	deployPreviewApplication,
	rebuildApplication,
	rebuildPreviewApplication,
} from "@dokploy/server/services/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createCheck: vi.fn(),
	updateCheck: vi.fn(),
	commitInfo: vi.fn(),
	exec: vi.fn(),
	execRemote: vi.fn(),
	build: vi.fn(),
	container: vi.fn(),
	preview: vi.fn(),
	deploymentStatus: vi.fn(),
}));
vi.mock("@dokploy/server/services/admin", () => ({
	getDokployUrl: vi.fn().mockResolvedValue("https://dokploy.example.com"),
}));
vi.mock("@dokploy/server/services/deployment", () => ({
	createDeployment: vi.fn().mockResolvedValue({
		deploymentId: "deploy-id",
		logPath: "/tmp/build.log",
	}),
	createDeploymentPreview: vi.fn().mockResolvedValue({
		deploymentId: "preview-deploy-id",
		logPath: "/tmp/build.log",
	}),
	updateDeploymentStatus: mocks.deploymentStatus,
	updateDeployment: vi.fn(),
}));
vi.mock("@dokploy/server/services/github", () => ({
	findGithubById: vi.fn().mockResolvedValue({ githubId: "github-id" }),
	issueCommentExists: vi.fn().mockResolvedValue(true),
	getIssueComment: vi.fn().mockReturnValue("preview comment"),
	updateIssueComment: vi.fn(),
	createPreviewDeploymentComment: vi.fn(),
}));
vi.mock("@dokploy/server/services/preview-deployment", () => ({
	findPreviewDeploymentById: mocks.preview,
	updatePreviewDeployment: vi.fn(),
}));
vi.mock("@dokploy/server/services/domain", () => ({
	getDomainHost: (domain: { host: string }) => `https://${domain.host}`,
}));
vi.mock("@dokploy/server/services/patch", () => ({
	generateApplyPatchesCommand: vi.fn().mockResolvedValue(""),
}));
vi.mock("@dokploy/server/services/project", () => ({
	validUniqueServerAppName: vi.fn(),
}));
vi.mock("@dokploy/server/utils/providers/github", () => ({
	cloneGithubRepository: vi.fn().mockResolvedValue("clone-fixture;"),
	authGithub: () => ({
		rest: { checks: { create: mocks.createCheck, update: mocks.updateCheck } },
	}),
}));
vi.mock("@dokploy/server/utils/providers/git", () => ({
	getGitCommitInfo: mocks.commitInfo,
	cloneGitRepository: vi.fn(),
}));
vi.mock("@dokploy/server/utils/builders", () => ({
	getBuildCommand: mocks.build,
	mechanizeDockerContainer: mocks.container,
}));
vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: mocks.exec,
	execAsyncRemote: mocks.execRemote,
	ExecError: class ExecError extends Error {},
}));
vi.mock("@dokploy/server/utils/traefik/application", () => ({
	createTraefikConfig: vi.fn(),
}));
vi.mock("@dokploy/server/utils/notifications/build-success", () => ({
	sendBuildSuccessNotifications: vi.fn(),
}));
vi.mock("@dokploy/server/utils/notifications/build-error", () => ({
	sendBuildErrorNotifications: vi.fn(),
}));

const sha = "a".repeat(40);
const actualSha = "b".repeat(40);
const args = {
	applicationId: "app-id",
	titleLog: "Deployment",
	descriptionLog: `Hash: ${sha}`,
	previewDeploymentId: "preview-id",
};
const application = () => ({
	applicationId: "app-id",
	name: "Web",
	appName: "web-unique",
	sourceType: "github",
	githubId: "github-id",
	owner: "owner",
	repository: "repo",
	serverId: null,
	buildServerId: null,
	environmentId: "env-id",
	environment: {
		projectId: "project-id",
		name: "production",
		project: { name: "Project", organizationId: "org-id" },
	},
	domains: [],
});

describe("GitHub check lifecycle during application deployments", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(db.query.applications.findFirst).mockResolvedValue(
			application() as never,
		);
		mocks.preview.mockResolvedValue({
			appName: "preview-web-random",
			branch: "feature",
			pullRequestNumber: "42",
			pullRequestCommentId: "123",
			domain: { host: "preview.example.com" },
		});
		mocks.commitInfo.mockResolvedValue({ hash: sha, message: "Commit title" });
		mocks.createCheck.mockResolvedValue({ data: { id: 123 } });
		mocks.updateCheck.mockResolvedValue({});
		mocks.exec.mockResolvedValue({ stdout: "", stderr: "" });
		mocks.execRemote.mockResolvedValue({ stdout: "", stderr: "" });
		mocks.build.mockResolvedValue("build-fixture;");
		mocks.container.mockResolvedValue(undefined);
	});

	it.each([
		["deploy", deployApplication, "Deploy", "deploy-id"],
		["rebuild", rebuildApplication, "Deploy", "deploy-id"],
		[
			"preview deploy",
			deployPreviewApplication,
			"Preview",
			"preview-deploy-id",
		],
		[
			"preview rebuild",
			rebuildPreviewApplication,
			"Preview",
			"preview-deploy-id",
		],
	] as const)(
		"publishes in-progress and success for %s",
		async (_label, deploy, mode, id) => {
			await expect(deploy(args)).resolves.toBe(true);
			expect(mocks.createCheck).toHaveBeenCalledTimes(1);
			expect(mocks.createCheck).toHaveBeenCalledWith(
				expect.objectContaining({
					name: `Dokploy / web-unique / ${mode}`,
					head_sha: sha,
					external_id: id,
					status: "in_progress",
					details_url: expect.stringContaining(
						mode === "Preview" ? "tab=preview-deployments" : "tab=deployments",
					),
				}),
			);
			expect(mocks.updateCheck).toHaveBeenCalledWith(
				expect.objectContaining({
					check_run_id: 123,
					conclusion: "success",
					status: "completed",
				}),
			);
			expect(mocks.container).toHaveBeenCalledTimes(1);
		},
	);

	it.each([
		["deploy", deployApplication],
		["rebuild", rebuildApplication],
		["preview deploy", deployPreviewApplication],
		["preview rebuild", rebuildPreviewApplication],
	] as const)(
		"reports build failure for %s without replacing the build error",
		async (_label, deploy) => {
			const failure = new Error("Build failed");
			mocks.build.mockRejectedValueOnce(failure);
			await expect(deploy(args)).rejects.toBe(failure);
			expect(mocks.updateCheck).toHaveBeenCalledWith(
				expect.objectContaining({ conclusion: "failure" }),
			);
		},
	);

	it.each([deployApplication, deployPreviewApplication])(
		"reports clone failures on the webhook commit",
		async (deploy) => {
			const failure = new Error("Clone failed");
			mocks.exec.mockRejectedValueOnce(failure);
			await expect(deploy(args)).rejects.toBe(failure);
			expect(mocks.updateCheck).toHaveBeenCalledWith(
				expect.objectContaining({ conclusion: "failure" }),
			);
			expect(mocks.build).not.toHaveBeenCalled();
		},
	);

	it("uses the checked-out SHA when a queued webhook refers to an older commit", async () => {
		mocks.commitInfo.mockResolvedValue({
			hash: actualSha,
			message: "New commit",
		});
		mocks.createCheck
			.mockResolvedValueOnce({ data: { id: 123 } })
			.mockResolvedValueOnce({ data: { id: 456 } });
		await deployApplication(args);
		expect(
			mocks.updateCheck.mock.calls.map(([value]) => [
				value.check_run_id,
				value.conclusion,
			]),
		).toEqual([
			[123, "cancelled"],
			[456, "success"],
		]);
		expect(
			mocks.createCheck.mock.calls.map(([value]) => value.head_sha),
		).toEqual([sha, actualSha]);
	});

	it("starts manual deployment checks after clone on the actual full SHA", async () => {
		await deployApplication({ ...args, descriptionLog: "" });
		expect(mocks.exec.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.createCheck.mock.invocationCallOrder[0]!,
		);
		expect(mocks.createCheck).toHaveBeenCalledWith(
			expect.objectContaining({ head_sha: sha }),
		);
	});

	it("reads normal deployment commits from the build server and preview commits from their service directory", async () => {
		vi.mocked(db.query.applications.findFirst).mockResolvedValue({
			...application(),
			buildServerId: "build-server",
			serverId: "runtime-server",
		} as never);
		await deployApplication(args);
		expect(mocks.commitInfo).toHaveBeenCalledWith(
			expect.objectContaining({
				appName: "web-unique",
				serverId: "build-server",
			}),
		);
		await rebuildPreviewApplication(args);
		expect(mocks.commitInfo).toHaveBeenCalledWith(
			expect.objectContaining({
				appName: "preview-web-random",
				serverId: "runtime-server",
			}),
		);
	});

	it("deploys successfully when GitHub check creation is unavailable", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		mocks.createCheck.mockRejectedValue(new Error("Checks permission missing"));
		await expect(deployApplication(args)).resolves.toBe(true);
		expect(mocks.container).toHaveBeenCalled();
		expect(mocks.deploymentStatus).toHaveBeenCalledWith("deploy-id", "done");
		vi.restoreAllMocks();
	});
});
