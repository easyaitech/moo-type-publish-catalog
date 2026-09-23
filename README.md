# MOO TYPE 发布与数据看板

John 把成片交给朋友手动发 TikTok，朋友在这个页面回填帖子链接，助理再补播放数据。

公开页面仍是 GitHub Pages：<https://easyaitech.github.io/moo-type-publish-catalog/>

视频和封面继续放在 Google Drive（或别的 https 地址），不放进这个仓库。

## 架构

| 部分 | 放在哪 | 谁来写 |
|---|---|---|
| 标签、文案、网盘链接 | `catalog.json`，Pages 静态站 | 助理改 git |
| 发布链接、播放/点赞/评论/分享/收藏 | Cloudflare Worker + KV | 朋友在页面提交链接；助理用脚本写数据 |
| 成片文件 | Drive / 外部 URL | 不进 GitHub |

页面先读 `catalog.json`，再向 Worker 要同一批 `job_id` 的回填。哪边的时间更新，就用哪边。Worker 没部署时，列表、文案和下载仍然可用，只是不能在页面上提交。

选 Worker 而不是「打开 GitHub Issue」：朋友不用 GitHub 账号，链接就在卡片里提交，刷新后还在。这个环境没有 Cloudflare 登录，所以 Worker 要按下面的步骤部署一次。

## 朋友怎么用

1. 打开上面的 Pages 地址。
2. 用 **待发布 / 已发布** 看还没发的和已经发的。顶部数字是成片总数、待手动发布、已填链接，以及播放、点赞、评论合计。
3. 每张卡片的大标题是网盘文件夹名（例如 `ENFP-r0004`、`ISFP-home-r0002`）。下面一行是短标签（和标题不同时）、修订号和平台。复制文案（没有内嵌文案时，点「文案文件」去网盘复制），点 **下载视频**、**下载封面**。
4. 自己发到 TikTok。
5. 把帖子链接贴回这张卡片。链接需要是 `https://www.tiktok.com/...`、`https://vm.tiktok.com/...` 或 `https://vt.tiktok.com/...`。
6. 在页面上方填一次 **回填口令**（John 单独发，不在这个仓库里）。口令会留在这台浏览器里。
7. 点 **我已发布，提交链接**。卡片变成已发布。不用改 git。

「—」表示这项还没人填，不是抓取失败。这个站不会登录 TikTok。

如果黄条写着「回填服务还没接上」，说明 Worker 还没部署，或 `site-config.js` 里的地址还是空的。先把链接发给 John。

## 助理：用下载链接和文案加一条

```bash
python3 scripts/add_entry.py \
  --label "INTJ" \
  --video-url "https://drive.google.com/file/d/VIDEO_FILE_ID/view" \
  --cover-url "https://drive.google.com/file/d/COVER_FILE_ID/view" \
  --copy-text "第一行标题
第二行正文 #标签"
```

文案也可以来自文件：`--copy-file ./caption.txt`（和 `--copy-text` 二选一）。

卡片大标题是网盘文件夹名（`subfolder_name`），不是 `--label`。`--label` 是短标签，写在标题下面那一行。不传 `--subfolder-name` 时，文件夹名是 `标签-修订号`（例如 `INTJ-r0001`）。网盘文件夹另有名字时再写，例如 `--subfolder-name ISFP-home-r0002 --label "ISFP宅"`。

可选：`--revision r0001`、`--subfolder-name`、`--folder-url`、`--copy-drive-url`、`--job-id`。不写 `--job-id` 时会生成 `job-` 加 32 位随机字符。

Drive 的 `/file/d/<id>/` 会自动写成下载地址 `https://drive.google.com/uc?id=<id>&export=download`。已经是普通 https 的封面地址会原样当作下载地址。同一支视频文件不能加第二次。

然后提交并推到 `main`（或合并 PR）。Pages 会更新列表。这一步只改 `catalog.json`，不上传 mp4。

已有条目要补内嵌文案：改那条的 `publish_copy`，再跑：

```bash
python3 scripts/rebuild_catalog.py
```

现有 9 条的文案文件在网盘上，需要登录，所以看板里 `publish_copy` 仍是空的，卡片会给出「文案文件」链接。原来的查看链接都还在。ENFP 以前没有下载地址，现在按文件 id 补了一条，原来的「打开视频 / 封面」链接没换。

### catalog.json 里一条视频

```json
{
  "label": "INTJ",
  "job_id": "job-0123456789abcdef0123456789abcdef",
  "revision": "r0001",
  "stage": "WAITING_MANUAL_PUBLISH",
  "platform": "TikTok",
  "publish_link": "",
  "published_at": "",
  "publish_copy": "页面上可复制的文案",
  "stats": {
    "views": null,
    "likes": null,
    "comments": null,
    "shares": null,
    "saves": null,
    "updated_at": "",
    "source": ""
  },
  "drive_folder": "",
  "drive_video": "https://drive.google.com/file/d/VIDEO_FILE_ID/view",
  "drive_video_download": "https://drive.google.com/uc?id=VIDEO_FILE_ID&export=download",
  "drive_cover": "https://drive.google.com/file/d/COVER_FILE_ID/view",
  "drive_cover_download": "https://drive.google.com/uc?id=COVER_FILE_ID&export=download",
  "drive_publish_copy": "",
  "subfolder_name": "INTJ-r0001",
  "local_release": ""
}
```

`stage` 为 `WAITING_MANUAL_PUBLISH` 且 `publish_link` 为空 = 待发布。有发布链接时页面显示已发布。`job_id` 必须匹配 `job-` 加 8 到 64 位字母或数字，Worker 用它当键。

卡片 `<h2>` 用 `subfolder_name`（网盘文件夹名）。没有文件夹名时才用 `label`。标题下面一行是短标签（和标题相同则省略）、修订号和平台，不再把文件夹名重复一遍。已有条目的 `label` 和网盘文件夹名不用改。

## 怎么更新播放数据

数字不会自动抓。助理看到 TikTok 后台的数之后，写入目录：

```bash
python3 scripts/update_stats.py \
  --job-id job-0123456789abcdef0123456789abcdef \
  --views 1200 --likes 34 --comments 0 --shares 2 --saves 5
```

没写的那一项保持原样。`0` 可以写。然后把 `catalog.json` 推进 git，Pages 更新后就能看到。

Worker 已经部署时，可以同时写到线上（页面不用等 Pages）：

```bash
export MOO_API_BASE="https://moo-type-publish.<account>.workers.dev"
export MOO_ADMIN_TOKEN="部署时设置的管理员口令"
python3 scripts/update_stats.py --job-id job-... --views 1200 --likes 34 --comments 0 --shares 2 --saves 5 --push
```

朋友提交的链接只在 KV 里。要收进 git 做备份：

```bash
python3 scripts/pull_state.py --api "$MOO_API_BASE"
```

同一字段哪边 `published_at` / `stats.updated_at` 更新，合并时就用哪边。

## 部署回填服务

需要 Cloudflare 账号。前端继续放在 GitHub Pages，不要把 Pages 关掉。

```bash
cd worker
npm ci
npx wrangler login
npx wrangler kv namespace create MOO_STATE
```

把命令打印出来的 `id` 填进 `worker/wrangler.jsonc` 的 `kv_namespaces[0].id`，替换那串 0，然后提交。这个 id 不是密钥。

口令至少 12 个字符，两个不要相同。用 `openssl rand -hex 16` 生成。不要写进 git。

```bash
npx wrangler secret put FRIEND_TOKEN
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

| 密钥 | 谁有 | 作用 |
|---|---|---|
| `FRIEND_TOKEN` | 朋友，页面上的「回填口令」 | `POST /v1/publish` |
| `ADMIN_TOKEN` | 只有助理 | `POST /v1/stats` |
| `CLOUDFLARE_API_TOKEN` | 部署的人，或 GitHub Actions secret | `wrangler deploy` |
| `CLOUDFLARE_ACCOUNT_ID` | 同上，GitHub Actions secret | `wrangler deploy` |

`FRIEND_TOKEN` / `ADMIN_TOKEN` 用 `wrangler secret put` 放在 Cloudflare，不放进 GitHub 仓库。Actions 可选：仓库 Settings → Secrets 里加上 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 后，手动跑 **deploy-worker**。API token 需要 Workers Scripts 的编辑权限，以及对应账号的 KV 权限。

部署完成后，把 workers.dev 地址（不要末尾斜杠）写进 `site-config.js` 的 `apiBase`，提交并推送。Pages 更新后，朋友的提交才会打到 Worker。把 `FRIEND_TOKEN` 单独发给朋友。换口令就再跑一次 `wrangler secret put FRIEND_TOKEN`。

本地对照：

```bash
cp worker/.dev.vars.example worker/.dev.vars
cd worker && npx wrangler dev
```

另一个终端在仓库根目录：

```bash
python3 -m http.server 4173
```

打开 `http://127.0.0.1:4173/?api=http://127.0.0.1:8787`。`.dev.vars` 已在 `.gitignore` 里。

## 测试

```bash
python3 -m unittest tests.test_catalog -v
node --test tests/merge.test.mjs
cd worker && npm ci && npm test
```

Worker 测试用 Miniflare：没口令不能写、非 TikTok 链接会拒绝、朋友口令不能改数据、管理员可以写播放数，并且关掉进程再打开后链接还在。
