---
name: "🕵️ groundtruth missed a lie"
about: An agent overclaimed and groundtruth didn't catch it
title: "[missed] "
labels: ["missed-lie"]
---

**What did the agent claim?**
<!-- paste the agent's message / the --claim text -->

**What was actually true?**
<!-- e.g. tests were failing, the function was a stub, the package doesn't exist -->

**Minimal diff to reproduce**
```diff
<!-- the smallest change that should have been flagged -->
```

**How you ran it**
```
groundtruth ...
```

**Output you got vs. expected**
<!-- groundtruth said "claims hold up" but it should have flagged X -->
