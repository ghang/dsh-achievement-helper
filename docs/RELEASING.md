# 发布流程

维护日期：2026-10-29。`dsh-achievement-helper@0.2.1` 已在 [GitHub Release](https://github.com/ghang/dsh-achievement-helper/releases/tag/v0.2.1) 与 [npm](https://www.npmjs.com/package/dsh-achievement-helper/v/0.2.1) 发行，两处公开包与冻结包一致。唯一公开仓为 `ghang/dsh-achievement-helper`；插件榜投稿单独办理。已发布的 tag 和安装包保持冻结。

发布使用同一份验证过的 tgz：GitHub Release 保存预构建包和校验和，npm 官方公共源提供按包名安装，awesome-dsh-plugin 负责收录与发现。各渠道的上传、公开下载、市场可见和本机升级分别验收。

## npm OIDC 工作流

从0.2.2开始提供 `.github/workflows/publish-npm.yml`：GitHub Release 的
`published` 事件触发托管Ubuntu runner，核对准确来源tag、同SHA成功双Node CI、
包身份及资产SHA-256，然后将已冻结的版本tgz直接上传npm。固定名tgz通过GitHub
服务端摘要确认同包，不重复下载。工作流不重建候选，也不重复执行完整测试。
它不保存npm Token；发布job使用 `id-token: write`、`contents: read` 和
`actions: read`，npm在空工作目录使用独立空user/global配置获取OIDC身份。

一次性在npm包Settings的Trusted Publisher中绑定：owner `ghang`，repository
`dsh-achievement-helper`，workflow filename `publish-npm.yml`，不填environment，
允许直接 `npm publish`。首次配置仍需维护者二次验证，新绑定须在2天内完成首次
成功发行。先让workflow存在且通过检查，再临近获授权的新版本时绑定。
配置保存成功不能作为真实OIDC发行已通过的证据。
[官方配置规则](https://docs.npmjs.com/trusted-publishers/)，核查日期2026-10-29。

可先用已发行版本在main运行只读检查：

```sh
gh workflow run publish-npm.yml --repo ghang/dsh-achievement-helper \
  --ref main -f tag=v0.2.1 -f mode=verify
```

新版本须先生成候选、通过CI、建立附注tag，再公开GitHub Release。工作流将核对
GitHub服务端摘要与读取到的原包，并检查npm准确版本的SHA-1、SHA-512、公开下载
状态及稳定版latest；同版本已存在且摘要一致时只验收，不重复写入。不同摘要、
CI缺失或失败、输入与tag不符、错误仓库和非托管runner均阻断实际上传。
发布回执保存在Actions artifact `npm-publication-<run>-<attempt>`。

恢复只运行对应已授权tag的工作流，例如下个新版本为0.2.2时：

```sh
gh workflow run publish-npm.yml --repo ghang/dsh-achievement-helper \
  --ref v0.2.2 -f tag=v0.2.2 -f mode=publish
```

实际上传要求工作流的 `GITHUB_SHA` 和 `GITHUB_REF` 均对应该tag，不允许从main
借用其他tag的身份发布。主分支verify通过只证明读路径，首次新版本的真实npm
发行才证明OIDC绑定有效。原有本机TTY流程作为明确选择的人工路径保留。
若将来在Actions中用 `GITHUB_TOKEN` 创建Release，应合并发布job或显式dispatch，
不能依赖它再次触发release工作流。
[GitHub触发限制](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。

## 1. 核对源码、身份与版本

继续维护现有独立 Git 历史，不重新初始化仓库。先审查本次变更、公开文件与图片；不加入本地档案、原始会话、凭据、浏览器存储、个人配置、测试输出或依赖目录。自动扫描不能代替逐文件与图片审核。

公开提交身份已核对为 `ghang <12455956+ghang@users.noreply.github.com>`。只在本仓使用该身份，不修改全局 Git 配置；环境覆盖、所有可达提交的 author/committer、邮箱 trailer 与附注 tagger 都要检查。GitHub 登录身份与提交署名分别核对。

在源码根目录进行只读检查：

```sh
git status --short
git remote -v
gh auth status --hostname github.com
gh api user --jq '{login, id}'
npm run check:identity -- --all
npm run check:source
```

目标 GitHub 账号为 `ghang`，已核对的 ID 为 `12455956`。维护环境已具备 GitHub CLI，正常发行复用现有认证；账号检查通过后不重复安装、登录或改用浏览器上传。首次建仓前，仓库 URL 只是计划目标；再次接手时先查询实际远端，已有目标仓库就沿用，不重复创建。包名是否可用、准确版本是否已存在也要在实际上传前重新查询。

完成版本、锁文件、README、CHANGELOG、本文及[版本说明](releases/0.2.0.md)的审核后，将明确的本次文件清单暂存并检查 `git diff --cached --check`、`git diff --cached`，形成待发行的本地提交。不要使用未审查的工作区给版本打 tag。

## 2. 生成并冻结候选

使用没有指向运行 profile 的依赖软链的独立 checkout，按锁文件准备开发依赖，然后运行完整门禁：

```sh
node scripts/install-dev.mjs
npm run check:release
```

`check:release` 依次执行以下检查；它不会创建远端仓库、提交、tag、Release、npm 版本或市场 PR。

| 门禁 | 检查范围 |
| --- | --- |
| `check:identity` | 当前生效身份、完整可达提交历史与附注 tag 的公开署名 |
| `check:source` | 当前公开源码的内容、路径和隐私；图片按二进制及素材清单检查。既有历史内容另做人工复核 |
| `check:package` | 源码回归、干净构建、实际 tgz 的清单、入口、素材和解包集成；绑定源码提交与树 |

完整检查已包含源码测试，不必在它之前重复全跑 `npm test`。失败或跳过不能标记为完整通过。实际宿主与浏览器验收仍需对这份候选单独留证，源码/解包回归不等于已经安装或公开发布。

公开仓的 `.github/workflows/check.yml` 在分支 push、PR 和手动触发时运行 Node `22.19.0`、`24.18.1` 两个门禁；job 名分别为 `check (22.19.0)`、`check (24.18.1)`。报告始终尝试保留，成功后保留实际 tgz 14 天。tag push 不重复完整门禁，发行复用同一来源 SHA 已成功的分支或手动 run，并单独核对个人附注 tag。workflow 只读仓库，不自动发布。工作流文件存在或本地验证成功都不能当作远端 CI 已通过。

本地输出保存在被忽略的 `.release/`：

```text
.release/dsh-achievement-helper.tgz
.release/dsh-achievement-helper-0.2.0.tgz
.release/SHA256SUMS
.release/package-report.json
.release/release-plan.json
```

两份 tgz 文件名不同，字节必须相同。`package-report.json` 保存实际包与测试结果；`release-plan.json` 保存包名、版本、`sourceCommit`、`sourceTree`、SHA-256、大小、清单和渠道目标。计划中的 `created`、`published`、`submitted` 标志不构成远端成功回执。

CHECK：完整门禁通过、待发源码工作区干净、HEAD 与计划的 `sourceCommit` 一致；核对 `sourceTree`、包名、版本、文件清单、SHA-256 及实际宿主验收。此后冻结该包，两个渠道直接上传同一原包，不从源码重新打包。源码或包内容变化时重新生成候选；已公开的同版本、tag 和资产不覆盖。

## 3. 从旧包名升级

包名与仓库改为 `dsh-achievement-helper`，显示名仍是「成就手记」。运行时插件 ID、`storages/achievement-journal/`、浏览器恢复请求的存储键和四个 `achievement_*` 模型工具保持兼容；新 API 前缀为 `/dsh-achievement-helper/api`，旧 `/dsh-achievement-journal/api` 保留别名。

在任务间隙停止使用目标宿主，备份完整插件专属存储，然后从同一 profile 移除旧包并安装新包。不要同时加载两个包，它们观察同一活动并使用同一存储和工具名。以下命令仅在明确要升级该 web profile 时执行：

```sh
dsh plugin --profile web remove dsh-achievement-journal
dsh plugin --profile web add /absolute/path/dsh-achievement-helper-0.2.0.tgz
```

卸载保留真实档案。不要删除或重命名 `storages/achievement-journal/` 来配合包名变化，也不修改 Session 真源。本次重命名不新增模型工具；首次安装仍增加四项模型可见工具，安装/卸载在长会话中可能改变请求前缀缓存与费用。

rc.5/rc.6 的既有档案保持同一数据协议。首次改名后，永久请求去重记录使旧 rc.4 及之前的严格 reader 无法读取，即使恢复原名也不能直接降级；较早版本另有画风、生成数量及 schema 的限制。降级须停宿主并恢复对应版本的完整存储备份，不能用旧备份覆盖后续新活动。首次公开版本没有上一公开稳定包可供回滚。

## 4. 首次远端准备与 GitHub Release

本节及后续 npm/投稿命令会写入外部服务，仅在本次版本与目标渠道的发布授权明确后执行。以下 `0.2.0` 命令保留首发时的步骤；该版本已经发行，不重复上传。后续版本需先更新版本和候选，再核对授权及渠道状态。

GitHub 发行优先使用维护方 Deepseek Lab 的通用 `tools/plugin-release` 工具。它上传已冻结的原包，不构建，不创建仓库、commit、tag，不 push，也不发布 npm。首次公开仓和 origin 已建立，后续沿用现有独立历史；每版仍须推送准确来源提交、核对真实 CI 并创建个人附注 tag。

### 4.1 首次建仓、推送与 CI

```sh
RELEASE_REPO='ghang/dsh-achievement-helper'
RELEASE_TAG='v0.2.0'
RELEASE_COMMIT='<release-plan.json 中已核对的 sourceCommit>'
RELEASE_ARTIFACT="$(pwd)/.release/dsh-achievement-helper.tgz"
```

CHECK：账号、提交、准确版本及已有远端状态符合本次计划。仅当仓库尚未创建且本地没有 `origin` 时，创建目标仓库并使用 SSH 远端；不附加另一套 README、许可或历史：

```sh
gh repo create "$RELEASE_REPO" --public --source=. --remote=origin \
  --description='Personal themed achievements and character collections for DeepSeek Harness.'
git remote set-url origin git@github.com:ghang/dsh-achievement-helper.git
git remote get-url origin
git push origin "$RELEASE_COMMIT:refs/heads/main"
gh repo edit "$RELEASE_REPO" --default-branch main --add-topic dsh-plugin
```

首次推送只发送审核过的发行提交及其既有独立历史，不使用 `--mirror` 或强制推送。已有仓库时只推本次审核过的提交。建仓和分支/topic 命令见 [GitHub CLI 建仓](https://cli.github.com/manual/gh_repo_create)与[仓库设置](https://cli.github.com/manual/gh_repo_edit)，核查日期：2026-10-26。等待准确来源 SHA 的两个 CI job 成功、未跳过，记录真实 run ID，再创建附注 tag、检查 tagger 与全部历史并推送：

```sh
git tag -a "$RELEASE_TAG" "$RELEASE_COMMIT" -m 'dsh-achievement-helper 0.2.0'
npm run check:identity -- --all
git push origin "refs/tags/$RELEASE_TAG"
```

tag 必须仍指向通过 CI 的同一提交；不为 tag push 再跑一轮完整构建。CI 未运行或未成功时停止发行准备中的远端写步骤，不能借用其他包、其他 SHA 或 PR 合成提交的成功结果。

### 4.2 用通用工具发行冻结包

从 Lab 根目录阅读 `tools/plugin-release/README.md` 并准备审核过的发行 manifest，含本机路径的 manifest 留在 Lab。它与本插件 `.release/release-plan.json` 不同：后者是候选来源记录，不能直接作为通用工具输入。manifest 应绑定 `ghang/dsh-achievement-helper`、`0.2.0`、`v0.2.0`、准确 commit、个人身份、冻结报告、包与校验和；带版本 tgz 通过 `extraTarballs` 列出，与固定名 tgz 同字节，校验和覆盖两者。

`ci.workflow` 为 `.github/workflows/check.yml`，`ci.jobs` 为上述两个准确 job 名，`ci.runId` 必须来自已核对的真实成功 run。草案中的 `ci.runId: null` 表示尚未就绪，不能记作 CI 或发行预演通过。没有远端仓库、origin、同 SHA 成功 CI 或个人附注 tag 时，先保留草案，不伪造门禁结果。

只读预演与公开下载复验分别执行；以下路径须替换为本次已审核的 Lab manifest：

```sh
make release-plan PLAN=/absolute/path/reviewed-release-manifest.json
make release-verify PLAN=/absolute/path/reviewed-release-manifest.json
```

`plan` 核对本地与远端条件，`verify` 只匿名下载已经公开的附件并校验。首次发行前没有公开附件，不能以 `verify` 代替候选验收。确认本次 GitHub 公开发行已授权且所有门禁通过后，才执行写入：

```sh
make release-publish PLAN=/absolute/path/reviewed-release-manifest.json
```

工具创建草稿、上传缺失资产、下载验包后公开，再匿名下载复验。保留其脱敏回执；已有正式 Release 只核验，不覆盖 tag 或资产。断网或结果未知时先用同一 manifest 重新 `plan`；草稿缺少资产时按工具规则恢复，内容冲突则停止核对。这里不另写本插件专用上传器。

稳定下载文件名始终为 `dsh-achievement-helper.tgz`，供 `releases/latest/download/` 使用；带版本文件名只用于对应 tag 的固定链接。公开后下载和比对通过，才能将 GitHub 渠道标记为已验证。[GitHub Release 操作](https://cli.github.com/manual/gh_release_create)、[草稿发布](https://cli.github.com/manual/gh_release_edit)、[下载链接](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)，核查日期：2026-10-26。

### 4.3 独立维护时的手工 gh 路径

没有 Lab 工具时，可在本公开源码仓使用 GitHub CLI 完成同一流程；沿用 4.1 的身份、来源 SHA、成功 CI 与已推送附注 tag 门禁。本路径是替代入口，同一版本已由通用工具完成后不重复上传。先查询准确 tag 的远端 Release；已有正式版本只下载复验，已有草稿先比对说明和附件，只补缺失资产，绝不使用覆盖选项。仅在确认该 tag 没有 Release 时创建草稿：

```sh
gh release create "$RELEASE_TAG" \
  .release/dsh-achievement-helper.tgz \
  .release/dsh-achievement-helper-0.2.0.tgz \
  .release/SHA256SUMS \
  --repo "$RELEASE_REPO" --verify-tag --draft \
  --title 'dsh-achievement-helper 0.2.0' --notes-file docs/releases/0.2.0.md
```

`--verify-tag` 避免 Release 自动为另一个提交创建 tag；`--draft` 先保留待审核状态。核对远端 tag 指向、草稿说明和三个资产，并用已授权的 GitHub 身份将草稿资产下载到新的临时目录与冻结原文件逐字节比较；不要使用覆盖资产的选项：

```sh
gh release view "$RELEASE_TAG" --repo "$RELEASE_REPO" \
  --json tagName,isDraft,targetCommitish,assets
DRAFT_REVIEW_DIR="$(mktemp -d)"
gh release download "$RELEASE_TAG" --repo "$RELEASE_REPO" --dir "$DRAFT_REVIEW_DIR"
cmp .release/dsh-achievement-helper.tgz "$DRAFT_REVIEW_DIR/dsh-achievement-helper.tgz"
cmp .release/dsh-achievement-helper-0.2.0.tgz "$DRAFT_REVIEW_DIR/dsh-achievement-helper-0.2.0.tgz"
cmp .release/SHA256SUMS "$DRAFT_REVIEW_DIR/SHA256SUMS"
```

下载选项见 [GitHub CLI 资产下载](https://cli.github.com/manual/gh_release_download)，核查日期：2026-10-26。草稿的认证下载只验证待发布内容；后面的匿名下载验证公开可用性。

CHECK：草稿内容、tag、资产与候选完全一致后，执行公开发布并核验匿名公共下载：

```sh
gh release edit "$RELEASE_TAG" --repo "$RELEASE_REPO" \
  --draft=false --latest --verify-tag
node scripts/verify-public.mjs --channel github
```

## 5. npm 官方源发布

npm 单独使用真实 TTY 与个人认证，通用 GitHub 工具不代为登录或发布。使用已有个人配置 `~/.config/dsh-plugin-release/npmrc`，不打印内容、不复制进仓库、不清空或覆盖。`scripts/public-npm.mjs` 固定官方 registry，过滤大小写的 `npm_config_*` 及认证环境覆盖，拒绝通过命令行替换 registry/userconfig/globalconfig，使用源码树外的系统临时目录作为独立空工作目录，cache保留在 `.release/npm-public/`，并保留终端输入输出。公司默认配置不由该脚本修改。npm 配置来自命令行、环境与多级 npmrc，因此 manifest 中的 `publishConfig` 不能单独保证发布目标。[npm 配置规则](https://docs.npmjs.com/cli/v11/configuring-npm/npmrc/)，核查日期：2026-10-26。

先做只读检查：

```sh
node scripts/public-npm.mjs whoami
node scripts/public-npm.mjs view dsh-achievement-helper name maintainers repository --json
node scripts/public-npm.mjs view dsh-achievement-helper@0.2.0 version dist --json
```

核对个人账号、包名归属与准确版本。预期个人账号为 `ghang`；名称或版本返回 404 只说明采样时未找到，不能预留名称。登录失效时在真实交互终端执行 `node scripts/public-npm.mjs login --auth-type=web`，然后重新 `whoami`。按 npm 提示完成本次认证，不把密码、验证码、Token 或认证 URL 写入聊天或公开日志。[npm 2FA](https://docs.npmjs.com/accessing-npm-using-2fa/)，核查日期：2026-10-26。

CHECK：本次 npm 发布已授权，准确版本尚不存在、冻结包和 GitHub 同字节验收通过后，在保持 TTY 的终端执行：

```sh
node scripts/public-npm.mjs publish "$RELEASE_ARTIFACT" --access=public --ignore-scripts
node scripts/public-npm.mjs view dsh-achievement-helper@0.2.0 \
  version dist.tarball dist.integrity dist.shasum repository --json
node scripts/verify-public.mjs --channel npm
```

这里上传 tgz，不执行目录发布或重新 pack。不要将交互发布接入管道、heredoc 或无 TTY 的后台任务。`--dry-run` 仅为预演，不能证明权限或实际发行；npm 的同一包名与版本一经发布不可复用，即使 unpublish 也不能重用。[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)，核查日期：2026-10-26。

命令成功后以准确版本可公开下载、包名/版本正确、SHA-256 和字节与冻结包一致为准。`verify-public.mjs` 只查询并下载核验，不上传或改写远端。短暂 404、超时或上次结果未知时先查准确版本；已存在且同字节就复验，内容不同则停止排查，不重复上传或擅自升版。

## 6. 市场投稿与交接

投稿草案在 [market-entry.yml](market-entry.yml)，分类 `fun` 对应个人成就与角色收藏。目标仓库尚未公开时不要提交草案；Release稳定资产公开且校验通过后，把草案复制到awesome投稿分支，再在那里启用 `tarball` 行；不为投稿修改冻结源码或重打包。

投稿前重读当天的 [awesome-dsh-plugin 指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。2026-10-26 核查要求：仓库创建满 1 天，有可用代码、`dsh.bundle` 和 `dsh-plugin` topic；在自己的投稿分支只添加 `data/plugins/ghang__dsh-achievement-helper.yml`，不手改生成 README 或其他条目。描述应与代码相符。npm 可选，由发布包的 `repository` 字段自动关联，不添加 `npm:` 字段。可选 `tarball` 必须是 GitHub Release 托管的 HTTPS tgz；使用 `latest/download` 时资产名不带版本。

CHECK：仓库年龄、公开安装渠道、条目内容和投稿授权均满足后，在独立投稿 fork 的工作分支提交这一份 YAML，推送该分支，用已审核的说明文件创建 PR：

```sh
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin --base main \
  --head ghang:codex/add-dsh-achievement-helper \
  --title 'Add ghang/dsh-achievement-helper' --body-file /absolute/path/market-pr.md
```

PR 检查通过、维护者合并、网站/市场刷新及本机安装分别记录。保存脱敏回执中的 commit、tag、包 SHA-256、公开地址与核验时间；不把待发布计划写成已发行，也不因发布完成自动升级日常 profile。
