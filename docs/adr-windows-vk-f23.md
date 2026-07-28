# ADR: Windows Copilot 键 (`VK_F23`) 在低阶键盘 hook 强制 early-return

| 项目 | 内容 |
|------|------|
| 状态 | Accepted |
| 决议日期 | 2026-05-04 |
| 引入版本 | v0.9.5 之后（PR [#29](https://github.com/yee94/SayIt/pull/29)） |
| 影响范围 | Windows 平台、低阶键盘 hook |
| 程式码位置 | `src-tauri/src/plugins/hotkey_listener.rs` 之 `mod windows_hook` |

## Context

Windows 11 引入「Copilot 实体键」（部分键盘实体上有 Copilot 图示按键）。实体键按下时系统送出 `VK_F23` virtual-key code（`0x86`），由 Microsoft 保留供系统唤起 Copilot Quick View。

SayIt 使用 Win32 低阶键盘 hook（`SetWindowsHookExW(WH_KEYBOARD_LL)`）拦截全域键盘事件以侦测自订热键与修饰键状态。预设情况下，hook 程序会把所有 `KBDLLHOOKSTRUCT` 事件交给 SayIt 的侦测逻辑处理，再透过 `CallNextHookEx` 传给下一个 hook。

社群回报：在 SayIt 开启时，按 Copilot 实体键无反应，Windows 11 Quick View 无法唤起。根因是 SayIt 的 hook 在处理 `VK_F23` 时干扰了系统 Copilot 键事件链。

## Decision

在 `windows_hook::hook_proc` 取出 `KBDLLHOOKSTRUCT` 结构之后、执行任何 SayIt 侦测逻辑之前，立刻判断 `kbd.vkCode == VK_F23` 并 early-return：

```rust
let kbd = *(l_param.0 as *const KBDLLHOOKSTRUCT);
// Ignore Copilot's dedicated VK_F23 signal to avoid interfering with Quick View.
if kbd.vkCode == VK_F23 {
    return CallNextHookEx(None, n_code, w_param, l_param);
}
```

并把 `0x86` 抽成具名常数 `const VK_F23: u32 = 0x86;` 与其他 Windows VK 常数并列。

## Consequences

### 正面

- **Copilot 键恢复正常运作**：Windows 11 Quick View 不再被 SayIt 干扰。
- **与 Microsoft 系统标准对齐**：保留系统保留键码的原始语意。
- **效能微优**：early-return 跳过后续所有 modifier / hotkey 侦测逻辑。

### 负面

- **F23 不可作为 SayIt 自订热键（刻意 trade-off）**：使用者无法在热键设定中绑定 F23。实务上几乎无影响，因为：
  - 传统键盘没有 F23 键
  - Microsoft 已将 VK_F23 保留给 Copilot
  - SayIt 主流热键是 Fn / Ctrl / Alt 等常见键
- **Windows-only 行为，macOS 本机 `cargo check` 无法验证**：必须靠 CI windows runner 或实机测试。

## Alternatives Considered

| 方案 | 结论 |
|------|------|
| 不处理，留下原行为 | ❌ 会持续干扰 Windows 11 Copilot 键，社群会持续回报 |
| 把 VK_F23 加入「忽略 VK 集合」(`HashSet<u32>`) 集中管理 | ❌ 目前只有单一忽略项，硬编码判断反而清晰；过度抽象不符合 SayIt「不为假设未来需求设计」原则 |
| 条件性忽略（仅当系统 Copilot 启用时）| ❌ 侦测 Copilot 启用状态复杂且不稳定；保险起见一律忽略 |
| 使用 `pull_request_target` 等 workflow 层方案 | ❌ 与本决策无关（这是 hook 层问题） |

## References

- [Windows Virtual-Key Codes](https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes)
- PR #29: https://github.com/yee94/SayIt/pull/29
- Memory: `windows-platform-quirks.md`
