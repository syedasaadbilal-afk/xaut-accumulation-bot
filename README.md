# XAUT Accumulation Bot

Standalone StartOS service that grows an XAUT (tokenised gold) stack on Bitfinex by swinging between XAUT and BTC.

- Signal: the Larsson Line on **BTC priced in XAUT** (the XAUT/BTC chart inverted). Orange = hold BTC; navy/gray = hold XAUT. Signals use confirmed daily closes and act at the next open.
- Goal and yardstick: more XAUT, not more dollars.
- Execution: small limit orders, one at a time, through the USDT pairs (`tXAUT:UST`, `tBTCUST`).
- Safe by default: disabled, DRY_RUN, both caps off.

## Caps (all optional, all in Settings)

| Cap | What it does |
| --- | --- |
| Strategy entry cap | Skips the strategy's own flat-to-BTC entry while BTC is more than X% above the Larsson baseline. Re-checked daily. Never touches an open position or an exit. |
| New-money cap | Applies only to XAUT you deposit while the strategy already holds BTC. If BTC is more than X% above the baseline the new XAUT is held back, then converted when price returns within the cap (or left as XAUT if the strategy exits). `Only for deposits of at least Y% of the account` limits it to big lump sums. |
| Position cap | Hard ceiling on how much XAUT-equivalent may sit in BTC. |

New money is detected as a wallet balance rise the bot did not cause: the bot records its wallets at the end of every tick (and after its own trades), so any difference at the next tick is a deposit or withdrawal. Use a dedicated sub-account.

## Develop

```
npm install
npm test            # daemon unit tests
npm run build --workspace packages/dashboard
```
