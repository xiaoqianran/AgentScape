# Studio

人类编辑器与产品 UI，入口 main.js，公开路径 /。
使用 application/createSession.js 装配产品模块；输入、帧循环、面板和自动保存触发仍由本应用管理。
保留现有 editor/ui/react/build 结构和工作台功能，不增加企业式横向层。

任务见 tasks.jsonl。验证：npm run test:studio、npm run typecheck、npm run build。
