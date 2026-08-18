# ReadyMode Target Fix

The ReadyMode generator must use the company's plain booking path (`plain_agent_link`) and append runtime parameters exactly once.

This prevents malformed URLs containing two question marks, such as `/book/company?...?source=readymode...`.
