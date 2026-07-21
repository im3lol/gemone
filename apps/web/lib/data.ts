// Static mock data taken from the design screenshots.
// ponytail: hardcoded mocks — wire to the API when the backend (see IMPLEMENTATION_PLAN.md) lands.

/* ----------------------------- Landing ----------------------------- */

export const partners = ["AdGem", "CPX Research", "TOROX", "timewall", "lootably", "ayet studios"];

export const features = [
  { icon: "gift", title: "Many Ways to Earn", text: "Discover hundreds of offers, games, surveys and more." },
  { icon: "dollar", title: "Real Rewards", text: "Get paid with PayPal, gift cards and more." },
  { icon: "shield", title: "Safe & Secure", text: "Your data and earnings are always protected." },
  { icon: "zap", title: "Instant Updates", text: "Track your progress in real time." },
  { icon: "headset", title: "24/7 Support", text: "We're here to help you every step of the way." },
];

export const steps = [
  { n: 1, emoji: "🧑‍💻", title: "Create an account", text: "Sign up for free and verify your email." },
  { n: 2, emoji: "🚀", title: "Complete offers", text: "Choose an offer and follow the instructions." },
  { n: 3, emoji: "👛", title: "Get rewarded", text: "Earn points and redeem your rewards." },
];

export const waysToEarn = [
  { emoji: "🎮", title: "Play Games", text: "Play your favorite games and earn big rewards.", tint: "bg-purple-50", btn: "bg-purple-100 text-purple-700" },
  { emoji: "📋", title: "Surveys", text: "Share your opinion and get rewarded instantly.", tint: "bg-blue-50", btn: "bg-blue-100 text-blue-700" },
  { emoji: "📱", title: "App Offers", text: "Download apps and try new products.", tint: "bg-emerald-50", btn: "bg-emerald-100 text-emerald-700" },
  { emoji: "▶️", title: "Watch Videos", text: "Watch videos and earn easy points.", tint: "bg-amber-50", btn: "bg-amber-100 text-amber-700" },
  { emoji: "🛍️", title: "Shopping", text: "Shop online and earn cashback.", tint: "bg-pink-50", btn: "bg-pink-100 text-pink-700" },
  { emoji: "👥", title: "Referrals", text: "Invite friends and earn lifetime commissions.", tint: "bg-indigo-50", btn: "bg-indigo-100 text-indigo-700" },
];

export const testimonials = [
  { name: "Alex Johnson", quote: "GemOne is the best rewards platform I've ever used. Payouts are fast and support is amazing!", amount: "$250+", via: "PayPal", color: "#2563eb" },
  { name: "Sophie Martin", quote: "I love how many ways there are to earn. Surveys and games are my favorite!", amount: "$180+", via: "Amazon", color: "#f59e0b" },
  { name: "Michael Chen", quote: "Highly recommended! I've earned over $500 in gift cards. Super reliable platform.", amount: "$500+", via: "Gift Cards", color: "#12b76a" },
];

export const landingStats = [
  { value: "30,000+", label: "Active Users" },
  { value: "$2M+", label: "Paid to Users" },
  { value: "1M+", label: "Offers Completed" },
  { value: "50+", label: "Reward Options" },
];

/* ----------------------------- Dashboard ----------------------------- */

export const userStats = [
  { label: "Current Balance", value: "12,560", unit: "Points", sub: "≈ $12.56 USD", icon: "dollar", accent: "text-brand-600", tint: "bg-brand-50", spark: null },
  { label: "Today's Earnings", value: "1,250", unit: "Points", sub: "≈ $1.25 USD", icon: "trending", accent: "text-blue-600", tint: "bg-blue-50", spark: [3, 5, 4, 6, 5, 7, 6, 8] },
  { label: "Pending Rewards", value: "2,300", unit: "Points", sub: "≈ $2.30 USD", icon: "clock", accent: "text-amber-600", tint: "bg-amber-50", spark: null },
  { label: "Completed Offers", value: "87", unit: "Offers", sub: "View all →", icon: "check", accent: "text-purple-600", tint: "bg-purple-50", spark: null },
];

export const recommendedOffers = [
  { name: "RAID: Shadow Legends", badges: [["Hard", "red"], ["Game", "purple"]], points: "8,400", usd: "≈ $8.40", task: "Complete level 20", color: "#b91c1c", letter: "R" },
  { name: "MONOPOLY GO!", badges: [["Easy", "green"], ["Game", "purple"]], points: "6,000", usd: "≈ $6.00", task: "Reach board 10", color: "#dc2626", letter: "M" },
  { name: "Sofi: Bank & Invest", badges: [["Easy", "green"], ["Sign Up", "blue"]], points: "3,200", usd: "≈ $3.20", task: "Create an account", color: "#4f46e5", letter: "S" },
  { name: "TikTok", badges: [["Easy", "green"], ["App", "slate"]], points: "2,400", usd: "≈ $2.40", task: "Install and open", color: "#111827", letter: "T" },
  { name: "Quick Survey", badges: [["Easy", "green"], ["Survey", "amber"]], points: "800", usd: "≈ $0.80", task: "Complete survey", color: "#059669", letter: "Q" },
] as const;

export const continueEarning = [
  { name: "Coin Master", desc: "Attack, spin and build your village", badges: [["Game", "purple"], ["Easy", "green"]], progress: 42, points: "1,200", color: "#f59e0b", letter: "C" },
  { name: "Yuno Surveys", desc: "Share your opinion and get rewarded", badges: [["Survey", "amber"], ["Easy", "green"]], progress: 75, points: "600", color: "#10b981", letter: "Y" },
] as const;

export const achievements = [
  { emoji: "✅", title: "Task Master", text: "Complete 50 tasks", ring: "from-emerald-400 to-brand-600" },
  { emoji: "🎯", title: "Offer Hunter", text: "Complete 25 offers", ring: "from-blue-400 to-blue-600" },
  { emoji: "👑", title: "Streak King", text: "7-day streak", ring: "from-purple-400 to-purple-600" },
];

export const recentActivity = [
  { emoji: "📋", title: "Survey Completed", time: "2 minutes ago", amount: "+200", tint: "bg-blue-50" },
  { emoji: "📱", title: "App Installed", time: "1 hour ago", amount: "+1,000", tint: "bg-emerald-50" },
  { emoji: "🎯", title: "Offer Completed", time: "3 hours ago", amount: "+3,500", tint: "bg-purple-50" },
  { emoji: "🎁", title: "Daily Bonus Claimed", time: "Yesterday", amount: "+50", tint: "bg-amber-50" },
];

/* ----------------------------- Admin ----------------------------- */

const spark = (seed: number) =>
  Array.from({ length: 12 }, (_, i) => 40 + Math.round(30 * Math.sin(i / 1.7 + seed) + i * 2));

export const adminMetrics = [
  { label: "Total Users", value: "128,569", delta: "12.5%", icon: "users", color: "#12b76a", tint: "bg-brand-50", spark: spark(0) },
  { label: "Total Earnings", value: "$24,860.45", delta: "8.3%", icon: "wallet", color: "#3b82f6", tint: "bg-blue-50", spark: spark(1) },
  { label: "Total Paid", value: "$18,430.25", delta: "15.7%", icon: "send", color: "#8b5cf6", tint: "bg-purple-50", spark: spark(2) },
  { label: "Total Offers Completed", value: "346,782", delta: "10.1%", icon: "target", color: "#f59e0b", tint: "bg-amber-50", spark: spark(3) },
  { label: "Fraud Blocked", value: "2,593", delta: "18.6%", icon: "flag", color: "#f43f5e", tint: "bg-red-50", spark: spark(4) },
];

export const platformSeries = [
  { label: "May 12", earnings: 4200, payouts: 2600 },
  { label: "May 13", earnings: 3600, payouts: 2200 },
  { label: "May 14", earnings: 6400, payouts: 3200 },
  { label: "May 15", earnings: 5200, payouts: 2800 },
  { label: "May 16", earnings: 7600, payouts: 4200 },
  { label: "May 17", earnings: 6800, payouts: 5200 },
  { label: "May 18", earnings: 8800, payouts: 6000 },
];

export const usersBreakdown = [
  { name: "Active Users", value: 73856, pct: "57.4%", color: "#12b76a" },
  { name: "New Users", value: 28745, pct: "22.3%", color: "#3b82f6" },
  { name: "Inactive Users", value: 20968, pct: "16.3%", color: "#f59e0b" },
  { name: "Banned Users", value: 5000, pct: "3.9%", color: "#f43f5e" },
];

export const topCountries = [
  { flag: "🇺🇸", name: "United States", users: "28,569", pct: "22.2%" },
  { flag: "🇮🇳", name: "India", users: "17,682", pct: "13.7%" },
  { flag: "🇧🇷", name: "Brazil", users: "11,243", pct: "8.7%" },
  { flag: "🇵🇭", name: "Philippines", users: "9,856", pct: "7.7%" },
  { flag: "🇩🇪", name: "Germany", users: "7,985", pct: "6.2%" },
];

export const withdrawals = [
  { name: "John Smith", method: "PayPal", methodColor: "#003087", amount: "$50.00", status: "Completed", date: "May 18, 2026 10:24 AM" },
  { name: "Emma Johnson", method: "Amazon Gift Card", methodColor: "#ff9900", amount: "$25.00", status: "Completed", date: "May 18, 2026 09:45 AM" },
  { name: "Michael Brown", method: "Visa Gift Card", methodColor: "#1a1f71", amount: "$100.00", status: "Pending", date: "May 18, 2026 09:12 AM" },
  { name: "Sophia Davis", method: "PayPal", methodColor: "#003087", amount: "$75.00", status: "Completed", date: "May 17, 2026 08:33 PM" },
  { name: "William Wilson", method: "Google Play", methodColor: "#00a672", amount: "$15.00", status: "Processing", date: "May 17, 2026 07:50 PM" },
] as const;

export const offerPerformance = [
  { name: "RAID: Shadow Legends", completions: "12,568", earnings: "$5,654.10", color: "#b91c1c", letter: "R" },
  { name: "Monopoly GO!", completions: "9,423", earnings: "$4,120.30", color: "#dc2626", letter: "M" },
  { name: "Coin Master", completions: "8,752", earnings: "$3,875.20", color: "#f59e0b", letter: "C" },
  { name: "TikTok", completions: "7,654", earnings: "$3,210.40", color: "#111827", letter: "T" },
  { name: "Cash App", completions: "6,421", earnings: "$2,845.60", color: "#00d54b", letter: "$" },
];

export const fraudSeries = [
  { label: "May 12", v: 180 },
  { label: "May 13", v: 320 },
  { label: "May 14", v: 640 },
  { label: "May 15", v: 470 },
  { label: "May 16", v: 720 },
  { label: "May 17", v: 560 },
  { label: "May 18", v: 500 },
];

export const fraudCounters = [
  { icon: "alert", title: "Suspicious Signups", value: "1,245", color: "text-red-500", tint: "bg-red-50" },
  { icon: "ban", title: "Blocked IPs", value: "856", color: "text-blue-500", tint: "bg-blue-50" },
  { icon: "card", title: "Chargebacks", value: "492", color: "text-emerald-500", tint: "bg-emerald-50" },
];

export const adminKpis = [
  { icon: "shield", title: "Trust Score", value: "92.4%", tag: "Good", tagTone: "green", progress: 92, tint: "bg-emerald-50", bar: "bg-brand-500" },
  { icon: "chargeback", title: "Chargeback Rate", value: "0.48%", tag: "Low", tagTone: "blue", progress: 12, tint: "bg-blue-50", bar: "bg-blue-500" },
  { icon: "payout", title: "Payout Success Rate", value: "98.7%", tag: "Excellent", tagTone: "purple", progress: 98, tint: "bg-purple-50", bar: "bg-purple-500" },
  { icon: "status", title: "System Status", value: "All Systems Operational", tag: "100% Uptime", tagTone: "amber", progress: 100, tint: "bg-amber-50", bar: "bg-amber-500" },
] as const;
