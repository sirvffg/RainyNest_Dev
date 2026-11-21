# __SLUG__

RainyNest 插件。

## 开发

```bash
npm i -D @rainynest/plugin-types typescript
npx @rainynest/ext dev . --site http://localhost:3000
```

需要主项目 `.env` 里的 `EXT_DEV_TOKEN`（放本目录 `.env` 亦可）。

## 发布

```bash
npx @rainynest/ext build . -o dist
npx @rainynest/ext pack dist --format zip
# 产出 dist/__SLUG__.zip.rainy-plugin
```
