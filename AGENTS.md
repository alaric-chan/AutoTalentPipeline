Clarify questions when input is unclear before proceeding.

For this recruiting workbench, changes are usually expected to reach all three places: local workspace, GitHub main, and the production server. After code changes that are intended for the live app, run verification and then publish with:

```bash
npm run publish -- "describe what changed"
```

Do not publish automatically when the user frames the work as an experiment, asks only for analysis, or explicitly says not to deploy.
