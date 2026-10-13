# Firebase release runbook

Normal Workspace users never use this procedure. They only open the Firebase Hosting URL and sign in with their approved GitHub account.

## One-time administrator setup

1. Create `staging` and `production` GitHub Environments. Require approval for `production`.
2. Configure GitHub OIDC workload identity in Google Cloud and grant its deployment service account the minimum Firebase Hosting, Cloud Functions, Realtime Database Rules, Secret Manager accessor, Cloud Scheduler and Service Usage permissions for each project.
3. Add the GitHub Environment secrets `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT`.
4. Add Environment variables `FIREBASE_PROJECT_ID_*`, `WORKSPACE_FUNCTIONS_BASE_*`, and `WORKSPACE_HOSTING_ORIGIN_*`.
5. In each Firebase project, configure the GitHub provider and add its Hosting domains to Firebase Authentication's authorized domains.
6. Set `SLACK_BOT_TOKEN`, `GITHUB_TOKEN_GANDT`, `GITHUB_TOKEN_YSSOLO`, `GITHUB_TOKEN_SHOTA656`, and `GITHUB_WEBHOOK_SECRET` through Firebase Secret Manager. Do not put values in GitHub variables, source code, browser storage, or RTDB.

## Release

Run **Firebase release** with `staging`. It runs browser tests, deploys Functions, Rules and Hosting, then verifies CORS and that the session endpoint fails closed without an ID token. Complete the staging acceptance flow before manually running the same workflow for `production`.

## Acceptance flow

Use an approved GitHub account in a normal browser: Hosting URL → GitHub sign-in → Dashboard → create Project/Milestone/Task in a test repository → Issue creation → update the Issue → Workspace update → Slack digest. Confirm that an unapproved account cannot read RTDB or call a protected function.
