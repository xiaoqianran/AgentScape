# Foundation

只放少量底层机制，不建立通用业务容器。禁止导入 modules/application/apps/dev。
errors.js 仅保留基础错误类型，Asset 与 World 错误归各自模块。

PolicyEngine 当前仍含默认产品角色，这是迁移保留的已知限制；后续应通过显式注入收回 application，不能继续在此添加领域权限规则。
验证复用 npm run architecture:validate 和相关现有测试。
