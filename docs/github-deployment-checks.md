# GitHub deployment checks

Applications connected through a GitHub App publish a GitHub Check Run for normal
deployments and preview deployments, including manual deployments and rebuilds.
The check is in progress during deployment and completes with success or failure.
Its Details link opens the application's deployments or preview deployments tab
in Dokploy. Each application has separate Deploy and Preview checks, and each
deployment has its own check run.

New GitHub Apps created through Dokploy request **Checks: Read and write**.
For an existing GitHub App, update this repository permission in the app's
settings and approve the updated permissions for its installation. The GitHub
[Checks API requires this permission](https://docs.github.com/en/rest/checks/runs).
Permission or API errors are logged and do not prevent the deployment itself.

Webhook deployments begin tracking the event's commit. After cloning, Dokploy
uses the actual checkout's full commit SHA. If it differs, the earlier check is
cancelled and a new check tracks the commit being built. Manual deployments start
their check after cloning; rebuilds use the existing checkout. A commit that
cannot be verified is not reported as a successful deployment check.
