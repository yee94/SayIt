# ADR: Claude Code Review workflow 对 fork PR 的处理

| 项目 | 内容 |
|------|------|
| 状态 | Accepted |
| 决议日期 | 2026-05-08 |
| 引入版本 | v0.9.5 之后（commit `01e1f06`） |
| 影响范围 | GitHub Actions workflow |
| 程式码位置 | `.github/workflows/claude-code-review.yml` |

## Context

SayIt 启用了 [Claude Code GitHub App](https://github.com/apps/claude) 与两支 workflow：

1. `claude.yml` — 由 `@claude` comment 触发，回复 issue/PR 评论
2. `claude-code-review.yml` — 由 `pull_request` 事件触发，自动 review PR 变更

两支 workflow 都依赖 `anthropics/claude-code-action@v1`，该 action 透过 GitHub OIDC token 与 Anthropic 端点兑换 GitHub App installation token，再代表 App 操作 PR / issue。

实测发现：当 PR 来自 **fork repository**（外部贡献者，例如社群成员的 PR），`claude-code-review.yml` 永远失败。失败讯息：

```
error: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable
Could not fetch an OIDC token. Did you remember to add `id-token: write`
to your workflow permissions?
```

`claude-code-review.yml` 的 `permissions` 区块明确写了 `id-token: write`，但仍失败。

## Root Cause

GitHub 对 fork PR 采取**双层保护**，两层都针对 OIDC：

1. **第一层 — Workflow 不自动执行**：对外部 contributor 的 fork PR，第一次 workflow run 必须由 maintainer 手动 approve（透过 GitHub UI 或 `gh api -X POST /repos/{owner}/{repo}/actions/runs/{id}/approve`）
2. **第二层 — Token 强制 read-only**：即使 approve 跑起来，**fork PR 拿到的 GITHUB_TOKEN 永远是 read-only**，workflow 里写的 `permissions:` 区块（包括 `id-token: write`）**被 GitHub 强制忽略**

第二层是 GitHub 为了保护 base repo secrets 而设的硬性限制：若 fork PR 能拿到完整权限，恶意 PR 就能透过 workflow 变更窃取 secrets / 签署假 release。

结论：任何依赖 OIDC 的 action（`anthropics/claude-code-action@v1`、`aws-actions/configure-aws-credentials@v4` OIDC mode、其他 cloud provider 的 OIDC 整合）对 fork PR 都会失败。这不是 SayIt workflow 设定错误，是 GitHub 设计上的安全护栏。

## Decision

在 `claude-code-review.yml` 的 `claude-review` job 加入 `if` guard：

```yaml
jobs:
  claude-review:
    # Skip fork PRs: forks cannot be granted id-token: write permission,
    # so anthropics/claude-code-action@v1 cannot mint an OIDC token and
    # the job would always fail. Same-repo branch PRs continue to run.
    if: github.event.pull_request.head.repo.full_name == github.repository

    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write
    # ...
```

判断依据：`github.event.pull_request.head.repo.full_name == github.repository` — 比较 PR 来源 repo 与 base repo，相同代表是同 repo branch PR（不是 fork）。

`claude.yml`（`@claude` comment）**不需要此 guard**，因为 `issue_comment` / `pull_request_review_comment` 事件由 base repo 触发，不受 fork PR 权限限制。

## Consequences

### 正面

- **Fork PR check 列表保持干净**：fork PR 的 `claude-review` 显示「skipped」（灰色），而非永久红色 ❌
- **无杂讯误导**：之后 contributor / maintainer 在 PR 介面看到的红色 check 都是真实问题，不会与「不能避免的杂讯」混淆
- **节省 Actions minutes**：fork PR 不会启动已知必失败的 job

### 负面

- **Fork PR 不会被自动 review**（不可避免的限制）：外部 contributor 的 PR 必须由 maintainer 手动触发 review，例如：
  - 在 PR 留言 `@claude review this PR`（触发 `claude.yml`，不受限）
  - Maintainer 把 PR rebase 进自己 branch 重新开 PR
  - 直接由 maintainer 人工 review

### 未来注意

- 此 guard 是**硬规则**，CLAUDE.md 与 `_bmad-output/project-context.md` 都已记载「禁止移除」
- 若 GitHub 未来放宽 OIDC 对 fork PR 的限制，可重新评估是否解除 guard

## Alternatives Considered

| 方案 | 结论 |
|------|------|
| 不加 guard，接受 fork PR 永远红色 ❌ | ❌ 杂讯大、误导 contributor |
| 改用 `pull_request_target` 事件 | ❌ 此事件以 base repo 身份执行、可拿到 secrets，但同时会 checkout fork code，安全风险极高（fork code 可在 base repo 环境执行任意动作）— 业界一致不推荐 |
| 完全移除 `claude-code-review.yml` | ❌ 同 repo branch PR（maintainer 自己 push）就拿不到 auto review 了，浪费已设定好的 App + secret |
| 加更精细的 `if` 条件（例如仅 trusted contributor） | ❌ `author_association` 判断复杂且 GitHub 对 first-time contributor 标记不稳定；单纯比较 head repo 即可、最不容易出错 |

## References

- [GitHub Docs — Approving workflow runs from public forks](https://docs.github.com/en/actions/managing-workflow-runs/approving-workflow-runs-from-public-forks)
- [GitHub Docs — Events that trigger workflows: `pull_request_target`](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#pull_request_target)
- Commit `01e1f06` — `ci(claude-review): skip fork PRs to avoid permanent OIDC failure`
- Memory: `cicd-patterns.md` — Fork PR 拿不到 id-token write 权限段
