# Tampermonkey 文章导出脚本

文件：`article-exporter.user.js`

这个脚本会在页面右下角注入一个“导出 Markdown ZIP”按钮，也会在 Tampermonkey 菜单里注册同名命令。点击后会：

1. 识别当前页面标题和文章正文。
2. 清理评论区、推荐区、侧边栏、分享栏等常见噪音。
3. 下载正文中的图片，并把 Markdown 里的图片地址改成 `image/xxx.ext` 相对路径。
4. 打包生成一个 ZIP：

```text
文章标题.zip
├─ 文章标题.md
└─ image/
   ├─ image-001.png
   └─ image-002.jpg
```

## 已覆盖的站点

- 知乎专栏
- 知乎问题页中的首个正文回答
- CSDN 博客文章
- 博客园文章
- 常见个人博客（通过通用选择器 + Readability 回退提取）

## 使用方法

1. 安装 Tampermonkey。
2. 新建脚本，把 `article-exporter.user.js` 内容粘进去保存，或直接导入该文件。
3. 打开文章页面。
4. 点击右下角按钮，或者从 Tampermonkey 菜单执行“导出当前文章为 Markdown ZIP”。
5. 浏览器会下载一个 ZIP 文件。

## 实现说明

- 依赖 `JSZip` 负责打包 ZIP。
- 依赖 `Turndown` 和 `turndown-plugin-gfm` 把 HTML 转成 Markdown。
- 依赖 `Readability` 作为个人博客/非标准页面的通用正文提取回退。
- 图片下载使用 `GM_xmlhttpRequest`，以减少跨域限制对抓图的影响。

## 当前限制

- 对强登录、强防盗链、图片必须带鉴权 Cookie 的页面，个别图片可能抓取失败，失败图片会从导出结果中移除。
- 知乎问题页如果存在多条回答，默认导出主栏中识别到的第一条正文回答，不会自动合并整页所有回答。
- 极少数重度前端渲染页面，如果正文尚未加载完成就执行导出，可能需要等页面稳定后再点一次。
