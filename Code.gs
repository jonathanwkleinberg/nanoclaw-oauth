// ============================================================
// Gmail Cleanup & Automation — COMPLETE SCRIPT
// ============================================================
//
// SETUP:
// 1. Go to https://script.google.com
// 2. Create a new project (or clear your existing one)
// 3. Paste this ENTIRE file (replace everything)
// 4. Save (Ctrl+S)
// 5. Select "setupAllTriggers" from the dropdown → click Run
// 6. Approve permissions when prompted
// 7. Done! Everything runs automatically from here.
//
// This script is SILENT — it does NOT send any emails.
// Reporting/digests are handled separately in Claude Cowork.
//
// ============================================================


// ========================
// CONFIGURATION
// ========================

const CONFIG = {
  // How old (in days) before unread promos/social get auto-archived
  promoArchiveAgeDays: 7,

  // How old (in days) before unread updates get auto-archived
  updateArchiveAgeDays: 30,

  // How old (in days) before ALL unread non-important email gets marked as read
  markReadAgeDays: 365,

  // Threads per search query (max 500 — the Gmail API limit)
  maxThreadsPerQuery: 500,

  // Stop processing when this many seconds remain (Apps Script has 360s limit)
  // Leave buffer so we don't get killed mid-operation
  safetyBufferSeconds: 30,

  // Smart detection: if a sender sent you this many emails in N days
  // and you never opened any, auto-flag them as junk
  junkThresholdCount: 5,
  junkThresholdDays: 30,

  // Senders that should NEVER be auto-flagged as junk
  protectedSenders: [
    "cibc.com",
    "yrdsb.ca",
    "407etr.com",
    "paypal.com",
    "enbridgegas.com",
    "google.com",
    "github.com",
    "gmail.com",
    "workday.com",
    "aircanada.ca",
    "aircanada.com",
  ],

  // Set true to preview what would happen without actually doing it
  dryRun: false,
};


// ========================
// LABELING RULES
// ========================

const LABEL_RULES = [
  {
    label: "Finance",
    senders: ["cibc.com", "407etr.com", "intl.paypal.com", "paypal.com",
              "prestocard.ca", "enbridgegas.com"],
    subjectPatterns: ["payment", "invoice", "statement", "balance", "transaction"],
  },
  {
    label: "School",
    senders: ["yrdsb.ca", "alexander.muir.ps@yrdsb.ca"],
    subjectPatterns: [],
  },
  {
    label: "Tech",
    senders: ["github.com", "ollama.com", "email.openai.com",
              "plex.tv", "mailout.plex.tv", "unity3d.com"],
    subjectPatterns: [],
  },
  {
    label: "Shopping/Receipts",
    senders: ["uber.com", "pharmacy.walmart.ca", "aircanada.ca",
              "notification.aircanada.ca", "info.aircanada.com",
              "account.xfinity.com"],
    subjectPatterns: ["receipt", "order confirmation", "shipping",
                      "delivered", "your order", "purchase"],
  },
  {
    label: "Work",
    senders: ["workday.com"],
    subjectPatterns: [],
  },
  {
    label: "LinkedIn",
    senders: ["linkedin.com"],
    subjectPatterns: [],
  },
];

// Labels to create on first run
const LABELS_TO_CREATE = [
  "Finance", "School", "Tech", "Shopping/Receipts",
  "Newsletters", "Auto-Archived",
];


// ========================
// TRIGGER SETUP (run once)
// ========================

/**
 * Run this ONCE. Creates all triggers and initial labels.
 */
function setupAllTriggers() {
  // Create labels
  Logger.log("🏗️ Setting up labels...");
  const existingLabels = GmailApp.getUserLabels().map(l => l.getName());
  for (const name of LABELS_TO_CREATE) {
    if (!existingLabels.includes(name)) {
      GmailApp.createLabel(name);
      Logger.log("  + Created label: " + name);
    } else {
      Logger.log("  ✓ Already exists: " + name);
    }
  }

  // Seed the junk list if first time
  getJunkSenders();

  // Clear old triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log("\n🗑️ Cleared old triggers");

  // Bulk cleanup every 1 HOUR for optimal throughput
  ScriptApp.newTrigger("bulkCleanupWithAutoStop")
    .timeBased().everyHours(1).create();
  Logger.log("⏰ Created: bulk cleanup every hour (auto-stops when done)");

  // Daily maintenance at 7am
  ScriptApp.newTrigger("dailyAutomation")
    .timeBased().everyDays(1).atHour(7).create();
  Logger.log("⏰ Created: daily automation at 7am");

  Logger.log("\n✅ All set! Bulk cleanup starts soon.");
  Logger.log("   It will run every hour, processing up to ~5000 threads per run.");
  Logger.log("   Once the backlog is cleared, it auto-stops and daily automation takes over.");
}


// ========================
// TIMER - keeps us under the 6-minute limit
// ========================

let _startTime = null;

function startTimer() {
  _startTime = new Date().getTime();
}

function hasTimeLeft() {
  if (!_startTime) return true;
  const elapsed = (new Date().getTime() - _startTime) / 1000;
  return elapsed < (360 - CONFIG.safetyBufferSeconds);
}

function elapsedSeconds() {
  if (!_startTime) return 0;
  return Math.round((new Date().getTime() - _startTime) / 1000);
}


// ========================
// DYNAMIC JUNK SENDER LIST
// (stored in Script Properties — grows automatically)
// ========================

function getJunkSenders() {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty("JUNK_SENDERS");
  if (stored) return JSON.parse(stored);

  // Initial seed list
  const seed = [
    "marketing.jerseymikes.com",
    "marketing.lyftmail.com",
    "hertzlistens.com",
    "motorola-mail.com",
    "pluto.tv",
    "email-caasco.com",
    "rs.ca.nextdoor.com",
    "is.ca.nextdoor.com",
    "info.cibc.com",
    "cias.org",
    "email.coinsquare.com",
    "yaserhussain-realty.com",
    "yelp.com",
  ];
  props.setProperty("JUNK_SENDERS", JSON.stringify(seed));
  return seed;
}

function addJunkSenders(newSenders) {
  const current = getJunkSenders();
  const added = [];
  for (const sender of newSenders) {
    if (!current.includes(sender)) {
      current.push(sender);
      added.push(sender);
    }
  }
  if (added.length > 0) {
    PropertiesService.getScriptProperties()
      .setProperty("JUNK_SENDERS", JSON.stringify(current));
    Logger.log("  ➕ New junk senders: " + added.join(", "));
  }
  return added;
}

/** View current junk list — run manually anytime */
function viewJunkSenders() {
  const senders = getJunkSenders();
  Logger.log("📋 Junk senders (" + senders.length + "):");
  senders.forEach(s => Logger.log("  - " + s));
}

/** Remove a sender from junk — set SENDER below and run */
const SENDER_TO_UNJUNK = "example.com";
function unjunkSender() {
  const current = getJunkSenders();
  const filtered = current.filter(s => s !== SENDER_TO_UNJUNK);
  PropertiesService.getScriptProperties()
    .setProperty("JUNK_SENDERS", JSON.stringify(filtered));
  Logger.log("✅ Removed: " + SENDER_TO_UNJUNK);
}


// ========================
// SMART JUNK DETECTION
// ========================

/**
 * Finds senders you get lots of email from but never open.
 * Auto-adds them to the junk list.
 */
function detectNewJunkSenders() {
  if (!hasTimeLeft()) return [];
  Logger.log("🔍 Scanning for new junk patterns...");

  const days = CONFIG.junkThresholdDays;
  const threshold = CONFIG.junkThresholdCount;
  const threads = GmailApp.search(
    "is:unread newer_than:" + days + "d -is:starred -category:personal", 0, 500
  );

  // Count unread by sender domain
  const senderCounts = {};
  for (const thread of threads) {
    if (!hasTimeLeft()) break;
    for (const msg of thread.getMessages()) {
      if (msg.isUnread()) {
        const domain = extractDomain(msg.getFrom());
        if (domain) senderCounts[domain] = (senderCounts[domain] || 0) + 1;
      }
    }
  }

  // Find high-volume senders you never read
  const currentJunk = getJunkSenders();
  const protectedSet = new Set(CONFIG.protectedSenders);
  const newJunk = [];

  for (const [domain, count] of Object.entries(senderCounts)) {
    if (!hasTimeLeft()) break;
    if (count >= threshold
        && !currentJunk.includes(domain)
        && !isProtected(domain, protectedSet)) {
      const readThreads = GmailApp.search("from:" + domain + " is:read newer_than:" + days + "d", 0, 1);
      if (readThreads.length === 0) {
        newJunk.push(domain);
        Logger.log("  🚩 Detected: " + domain + " (" + count + " unread, 0 read)");
      }
    }
  }

  if (newJunk.length > 0) {
    addJunkSenders(newJunk);
  } else {
    Logger.log("  ✅ No new junk senders found.");
  }
  return newJunk;
}


// ========================
// BULK CLEANUP — AGGRESSIVE MODE
// Runs every hour, loops until time runs out.
// Processes thousands of threads per run.
// ========================

function bulkCleanupWithAutoStop() {
  startTimer();
  Logger.log("🧹 Bulk cleanup — aggressive mode...");

  const junkSenders = getJunkSenders();
  let grandTotal = 0;

  // Build the list of cleanup queries
  const cleanupQueries = [
    { query: "category:promotions is:unread older_than:30d", label: "Auto-Archived" },
    { query: "category:social is:unread older_than:30d", label: "Auto-Archived" },
    { query: "category:updates is:unread older_than:" + CONFIG.updateArchiveAgeDays + "d -is:starred", label: "Auto-Archived" },
    { query: "category:promotions older_than:90d", label: "Auto-Archived" },
    { query: "category:social older_than:90d", label: "Auto-Archived" },
  ];

  // Add junk sender queries
  for (const sender of junkSenders) {
    cleanupQueries.push({ query: "from:" + sender + " older_than:7d", label: "Auto-Archived" });
  }

  // LOOP: keep processing each query until it returns 0 or time runs out
  for (const item of cleanupQueries) {
    if (!hasTimeLeft()) break;

    let passCount = 0;
    let batchTotal = 0;
    // Keep hitting the same query until it's empty
    while (hasTimeLeft()) {
      const processed = archiveByQuery(item.query, item.label);
      if (processed === 0) break;
      batchTotal += processed;
      passCount++;
    }
    if (batchTotal > 0) {
      Logger.log("  ✅ " + item.query.substring(0, 50) + "... → " + batchTotal + " threads (" + passCount + " passes)");
    }
    grandTotal += batchTotal;
  }

  // Mark very old unread as read — also loop
  if (hasTimeLeft()) {
    let readTotal = 0;
    while (hasTimeLeft()) {
      const oldThreads = GmailApp.search("is:unread older_than:1y -is:starred", 0, CONFIG.maxThreadsPerQuery);
      if (oldThreads.length === 0) break;
      for (const thread of oldThreads) {
        if (!hasTimeLeft()) break;
        if (!CONFIG.dryRun) thread.markRead();
        readTotal++;
      }
    }
    if (readTotal > 0) Logger.log("  📖 Marked " + readTotal + " old threads as read");
    grandTotal += readTotal;
  }

  // Auto-label — also loop
  if (hasTimeLeft()) {
    let labelTotal = 0;
    for (const rule of LABEL_RULES) {
      if (!hasTimeLeft()) break;
      while (hasTimeLeft()) {
        const count = labelSenderEmails(rule.senders, rule.label);
        if (count === 0) break;
        labelTotal += count;
      }
    }
    // Subject pattern labeling
    while (hasTimeLeft()) {
      const count = labelBySubjectPatterns();
      if (count === 0) break;
      labelTotal += count;
    }
    if (labelTotal > 0) Logger.log("  🏷️ Labeled " + labelTotal + " threads total");
    grandTotal += labelTotal;
  }

  // Smart detection (if time permits)
  if (hasTimeLeft()) {
    detectNewJunkSenders();
  }

  Logger.log("\n📊 This run: " + grandTotal + " threads processed in " + elapsedSeconds() + "s");

  // Auto-stop when done
  if (grandTotal === 0) {
    Logger.log("🎉 Inbox is clean! Removing 1-hr trigger.");
    removeTriggerByFunction("bulkCleanupWithAutoStop");
    Logger.log("✅ Bulk cleanup disabled. Daily automation takes over from here.");
  } else {
    Logger.log("⏳ More to do — next run in ~1 hr.");
  }
}

/** Manual one-shot cleanup (same aggressive logic) */
function bulkCleanup() {
  bulkCleanupWithAutoStop();
}


// ========================
// DAILY AUTOMATION
// ========================

function dailyAutomation() {
  startTimer();
  Logger.log("🤖 Daily automation...");
  const junkSenders = getJunkSenders();

  // Archive aging promos & social
  let promos = 0, social = 0;
  while (hasTimeLeft()) {
    const p = archiveByQuery(
      "category:promotions is:unread older_than:" + CONFIG.promoArchiveAgeDays + "d",
      "Auto-Archived"
    );
    if (p === 0) break;
    promos += p;
  }
  while (hasTimeLeft()) {
    const s = archiveByQuery(
      "category:social is:unread older_than:" + CONFIG.promoArchiveAgeDays + "d",
      "Auto-Archived"
    );
    if (s === 0) break;
    social += s;
  }

  // Archive junk senders (anything 1+ day old) — loop each
  let junk = 0;
  for (const sender of junkSenders) {
    if (!hasTimeLeft()) break;
    while (hasTimeLeft()) {
      const j = archiveByQuery("from:" + sender + " in:inbox older_than:1d", "Auto-Archived");
      if (j === 0) break;
      junk += j;
    }
  }

  // Auto-label recent mail
  let labeled = 0;
  for (const rule of LABEL_RULES) {
    if (!hasTimeLeft()) break;
    labeled += labelSenderEmails(rule.senders, rule.label, "newer_than:3d");
  }
  if (hasTimeLeft()) labeled += labelBySubjectPatterns("newer_than:3d");

  // Mark old unread as read
  let read = 0;
  while (hasTimeLeft()) {
    const oldThreads = GmailApp.search("is:unread older_than:1y -is:starred", 0, CONFIG.maxThreadsPerQuery);
    if (oldThreads.length === 0) break;
    for (const thread of oldThreads) {
      if (!hasTimeLeft()) break;
      if (!CONFIG.dryRun) thread.markRead();
      read++;
    }
  }

  // Archive old updates
  let updates = 0;
  while (hasTimeLeft()) {
    const u = archiveByQuery(
      "category:updates is:unread older_than:" + CONFIG.updateArchiveAgeDays + "d -is:starred",
      "Auto-Archived"
    );
    if (u === 0) break;
    updates += u;
  }

  // Smart detection
  const newJunk = hasTimeLeft() ? detectNewJunkSenders() : [];

  Logger.log("=".repeat(40));
  Logger.log("✅ Daily automation complete! (" + elapsedSeconds() + "s)");
  Logger.log("   Promos: " + promos + " | Social: " + social + " | Junk: " + junk);
  Logger.log("   Updates: " + updates + " | Labeled: " + labeled + " | Read: " + read);
  Logger.log("   New junk detected: " + newJunk.length);
  Logger.log("   Total junk senders tracked: " + junkSenders.length);
}


// ========================
// HELPER FUNCTIONS
// ========================

function archiveByQuery(query, labelName) {
  const threads = GmailApp.search(query, 0, CONFIG.maxThreadsPerQuery);
  if (threads.length === 0) return 0;
  const label = labelName ? getOrCreateLabel(labelName) : null;

  // Process in batches of 100 (Gmail API batch limit)
  for (let i = 0; i < threads.length; i += 100) {
    if (!hasTimeLeft()) break;
    const batch = threads.slice(i, i + 100);
    if (!CONFIG.dryRun) {
      if (label) {
        GmailApp.refreshThreads(batch);
        for (const thread of batch) {
          label.addToThread(thread);
        }
      }
      GmailApp.moveThreadsToArchive(batch);
    }
  }
  Logger.log("  📦 Archived " + threads.length + " (" + query.substring(0, 55) + ")");
  return threads.length;
}

function labelSenderEmails(senderList, labelName, dateFilter) {
  const label = getOrCreateLabel(labelName);
  let count = 0;
  for (const sender of senderList) {
    if (!hasTimeLeft()) break;
    const q = "from:" + sender + " -label:" + labelName.replace(/\//g, "-")
      + (dateFilter ? " " + dateFilter : "");
    const threads = GmailApp.search(q, 0, CONFIG.maxThreadsPerQuery);
    for (let i = 0; i < threads.length; i += 100) {
      if (!hasTimeLeft()) break;
      const batch = threads.slice(i, i + 100);
      if (!CONFIG.dryRun) {
        for (const thread of batch) {
          label.addToThread(thread);
        }
      }
      count += batch.length;
    }
  }
  if (count > 0) Logger.log("  🏷️ Labeled " + count + " → " + labelName);
  return count;
}

function labelBySubjectPatterns(dateFilter) {
  let count = 0;
  for (const rule of LABEL_RULES) {
    if (!hasTimeLeft()) break;
    if (rule.subjectPatterns.length === 0) continue;
    const label = getOrCreateLabel(rule.label);
    for (const pattern of rule.subjectPatterns) {
      if (!hasTimeLeft()) break;
      const q = 'subject:"' + pattern + '" -label:' + rule.label.replace(/\//g, "-")
        + (dateFilter ? " " + dateFilter : "");
      const threads = GmailApp.search(q, 0, CONFIG.maxThreadsPerQuery);
      for (const thread of threads) {
        if (!CONFIG.dryRun) label.addToThread(thread);
        count++;
      }
    }
  }
  if (count > 0) Logger.log("  🏷️ Subject-pattern labeled " + count + " threads");
  return count;
}

function getOrCreateLabel(name) {
  let label = GmailApp.getUserLabelByName(name);
  if (!label) label = GmailApp.createLabel(name);
  return label;
}

function extractDomain(fromHeader) {
  const match = fromHeader.match(/<(.+?)>/);
  const email = match ? match[1] : fromHeader;
  const parts = email.split("@");
  return parts.length === 2 ? parts[1].toLowerCase().trim() : null;
}

function isProtected(domain, protectedSet) {
  for (const p of protectedSet) {
    if (domain === p || domain.endsWith("." + p)) return true;
  }
  return false;
}

function removeTriggerByFunction(funcName) {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === funcName) {
      ScriptApp.deleteTrigger(t);
      Logger.log("  🗑️ Removed trigger: " + funcName);
    }
  }
}
