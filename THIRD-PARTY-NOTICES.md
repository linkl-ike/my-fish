# 第三方声明

## fish-core（内嵌在 fish/）

- 名称：dsh-fish-soul（本地维护版 fish-core）
- 版本：0.18.5-local.2
- 来源：https://github.com/Britneycode/dsh-fish-soul
- 许可：MIT
- 说明：本插件把 fish-core 的源码内置在 `fish/` 目录中作为子插件加载；其数据
  （`~/.dsh/fish-soul/`、`~/.dsh/fish-soul-config.json`）不属于本包内容。

## 其他

- 本插件 Host/Client 代码由本项目维护，MIT 许可。
- 面板中调用的 SnowLuma、fish-tts-shim、SurfCore 均不随本包分发，属可选外部服务。
