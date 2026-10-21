# CI：发布与 PR 预览

正式站和 PR 预览均由 **GitHub Actions 构建、Wrangler 推送到 Cloudflare Pages**。Cloudflare 不再拉取代码或执行构建。

| 配置 | 用途 |
| --- | --- |
| `wrangler.toml` | 共用项目、输出目录、兼容日期和环境绑定；`env.preview` 清空 D1 绑定 |
| `.github/workflows/pages-release.yml` | 模板 `main` 更新或手动运行时正式发布 |
| `.github/workflows/pr-preview-build.yml` | 构建 PR，包括外部 fork |
| `.github/workflows/pr-preview-deploy.yml` | 校验、发布静态产物，更新 PR 评论和 GitHub Deployment |
| `.github/workflows/pr-preview-cleanup.yml` | 每日检查保留策略，清理符合条件的旧预览 |

Wrangler 配置是受支持的 Pages 运行时配置的唯一来源；项目创建、生产分支、域名与 Git 自动部署开关不属于这些文件管理的范围。后续修改绑定、兼容日期和普通运行时变量，请提交仓库配置。凭据只放 GitHub Secrets，勿写入配置文件。

## 首次接入与切换

1. 正式站复用 `wrangler.toml` 中的 `buct-wiki` 项目。切换前，在临时目录使用 `pnpm dlx wrangler@4.151.3 pages download config buct-wiki` 获取线上配置，与仓库配置核对并补齐，避免遗漏原有绑定或变量。不要在仓库根目录直接下载并覆盖现有文件。
2. 确认现有项目的生产分支为 `main`。正式部署使用 `--branch main`；预览使用 `--branch pr-编号`。所有部署复用 `buct-wiki`，无需创建新项目或配置新域名。
3. 在组织仓库 `BUCT-WIKI/buct-wiki` 的 Settings → Secrets and variables → Actions 中设置：
   - Secret `CLOUDFLARE_API_TOKEN`：仅授予目标账户的 **Account → Cloudflare Pages → Edit** 权限。
   - Variable `CLOUDFLARE_ACCOUNT_ID`：该 Cloudflare 账户的 ID。
4. 关闭现有正式项目的 Git 自动生产部署和预览分支部署，再合入工作流。已有 Git 集成项目可以继续由 Wrangler 上传，无需删除项目或迁移域名。关闭 CF 拉取开关需要一次控制台或 API 操作，不能通过 Wrangler 配置文件声明。
5. 合入默认分支后，检查 `Pages release`，再新建或更新 PR 验证预览。`workflow_run` 发布工作流必须先存在于默认分支；首次外部贡献者的 Actions 可能需要维护者批准。

## 预览体验

模板 PR 使用 `pr-编号` 分支别名，例如 `pr-12.buct-wiki.pages.dev`。同一个 PR 的后续提交更新固定地址，每次部署还有独立的 `<部署哈希>.buct-wiki.pages.dev` 地址，便于对照旧版本。

机器人更新同一条 PR 评论，成功时展示最近成功预览、此次部署和提交编号；构建或发布失败时显示失败提示及对应运行日志。GitHub Deployment 在开始发布时标记为 pending，结束后记录 success 或 failure。过期提交不会覆盖当前 PR 的评论。评论中的网址取自 Wrangler 实际输出；这里的域名仅为示例。

构建在无部署凭据的 runner 中运行；发布在独立 runner 上使用默认分支的代码，不执行 PR 内的脚本。发布校验拒绝符号链接和 `_worker.js`，只上传静态文件，不携带正式站的 Functions 或 D1 绑定。已关闭或提交已变化的 PR 会跳过发布。

生产与预览共用可信的 `wrangler.toml`。顶层保留本地与生产环境的 D1 绑定，`[env.preview]` 通过 `d1_databases = []` 显式清空预览绑定；预览环境配置适用于所有预览分支。

## 预览保留策略

`PR preview cleanup` 每日 UTC 03:17（北京时间 11:17）运行，策略定义在 `scripts/preview-cleanup.cjs`：

- 进行中的 PR 保留最新 3 个成功版本，失败或取消的部署保留 7 天；构建中的部署不清理。
- PR 关闭或合并满 7 天后，其预览进入清理范围。重新打开的 PR 按进行中的 PR 处理。
- 只处理共用项目中 `environment=preview` 且能查到对应 PR 的部署。只处理 `pr-编号`；正式部署、其他分支与无法确认归属的记录均保留。删除前再次读取部署，确认环境和分支仍满足这些条件。
- 活动别名指向的部署会保留，Cloudflare 拒绝删除的部署也会保留并报告，**不使用强制删除**。因此关闭的 PR 通常仍可能留下一份最新预览，不能将此策略理解为所有预览都会到期消失。
- GitHub 构建 Artifact 保留 3 天，与 Cloudflare 部署的保留策略独立。

手动运行工作流默认选择 `plan`，只列出清理清单；选择 `apply` 才执行清理。每天的定时运行执行清理。候选列表及实际结果写入 Actions Summary；执行前会重新核对 PR 和部署状态。失败后可以重跑，已删除的部署不重复处理。

正式构建读取独立内容仓库的最新 `main`；模板 `main` 更新或手动运行时，由 `Pages release` 排队发布。

参考：[Pages Wrangler 配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)、[CI Direct Upload](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)。

预览从公开内容仓库获取文章，从 Git 历史生成贡献者与修改时间。反馈表单保留供审阅并明确提示不会提交，阅读量显示 `--`；预览不连接正式数据库。
正式和预览构建均沿用原有贡献者脚本，通过工作流自带、仅有 `contents: read` 权限的 `GITHUB_TOKEN` 查询 GitHub 作者资料；构建步骤不接收 Cloudflare 部署凭据。

本地运行 `pnpm run build:cloudflare --mode preview` 可验证预览构建，需要通过环境变量提供 `GITHUB_TOKEN`。预览复用正式构建命令，通过 Astro 内置的 `import.meta.env.MODE === 'preview'` 关闭反馈与阅读量请求，保留生产构建行为，无需自定义预览环境变量。`pnpm run test:preview` 检查预览产物校验、贡献者元数据和内容更新；测试使用模拟 API，无需真实 Token。
