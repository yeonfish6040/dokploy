import {
	createPreviewDeploymentComment,
	getIssueComment,
} from "@dokploy/server/services/github";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getDokployUrl: vi.fn(),
	findGithub: vi.fn(),
	createComment: vi.fn(),
	updatePreviewDeployment: vi.fn(),
}));

vi.mock("@dokploy/server/services/admin", () => ({
	getDokployUrl: mocks.getDokployUrl,
}));
vi.mock("@dokploy/server/db", () => ({
	db: { query: { github: { findFirst: mocks.findGithub } } },
}));
vi.mock("@dokploy/server/utils/providers/github", () => ({
	authGithub: () => ({
		rest: { issues: { createComment: mocks.createComment } },
	}),
}));
vi.mock("@dokploy/server/services/preview-deployment", () => ({
	updatePreviewDeployment: mocks.updatePreviewDeployment,
}));

describe("preview deployment GitHub comments", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-12T00:00:00.000Z"));
		mocks.getDokployUrl.mockResolvedValue("https://dokploy.example.com");
		mocks.findGithub.mockResolvedValue({ githubId: "github-id" });
		mocks.createComment.mockResolvedValue({ data: { id: 123 } });
		mocks.updatePreviewDeployment.mockResolvedValue([
			{ previewDeploymentId: "preview-id", pullRequestCommentId: "123" },
		]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it.each([
		["initializing", "🔄 Building"],
		["running", "🔄 Building"],
		["success", "✅ Done"],
		["error", "❌ Failed"],
	] as const)("includes both URLs for %s comments", async (status, label) => {
		const comment = await getIssueComment(
			"Web",
			status,
			"https://pr-42.example.com",
		);
		expect(comment).toContain(label);
		expect(comment).toContain("[Preview URL](https://pr-42.example.com)");
		expect(comment).toContain(
			"[Dokploy Dashboard](https://dokploy.example.com)",
		);
		expect(comment).toContain("2026-10-12T00:00:00.000Z");
	});

	it("uses the configured Dokploy URL including its protocol and port", async () => {
		mocks.getDokployUrl.mockResolvedValue("http://192.0.2.10:3000");
		expect(
			await getIssueComment("Web", "success", "https://preview.example.com"),
		).toContain("[Dokploy Dashboard](http://192.0.2.10:3000)");
	});

	it("includes the dashboard link when recreating a deleted PR comment", async () => {
		await createPreviewDeploymentComment({
			owner: "owner",
			repository: "repo",
			issue_number: "42",
			previewDomain: "https://pr-42.example.com",
			appName: "Web",
			githubId: "github-id",
			previewDeploymentId: "preview-id",
		});
		expect(mocks.createComment).toHaveBeenCalledWith(
			expect.objectContaining({
				issue_number: 42,
				body: expect.stringContaining(
					"[Dokploy Dashboard](https://dokploy.example.com)",
				),
			}),
		);
		expect(mocks.updatePreviewDeployment).toHaveBeenCalledWith("preview-id", {
			pullRequestCommentId: "123",
		});
	});
});
