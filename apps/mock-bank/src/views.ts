import { Account, Member } from "./types";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Shared page shell. Table-based, no CSS framework, no data-testid anywhere
 * in this file — that's intentional (see docs/architecture.md, "locator strategy").
 */
function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; margin: 20px; }
  table { border-collapse: collapse; }
  td { padding: 4px 8px; vertical-align: top; }
</style>
</head>
<body>
<table border="1" width="640">
<tr><td><b>Member Services Console</b> &mdash; ${escapeHtml(title)}</td></tr>
<tr><td>
${bodyHtml}
</td></tr>
</table>
</body>
</html>`;
}

export function renderSearchPage(): string {
  return layout(
    "Member Search",
    `
    <table cellpadding="4" cellspacing="0" border="1" width="100%">
      <tr><td colspan="2"><b>Member Search</b></td></tr>
      <tr>
        <td width="120">Member ID</td>
        <td>
          <form method="get" action="/members">
            <input type="text" name="memberId" size="10">
            <input type="submit" value="Search">
          </form>
        </td>
      </tr>
      <tr><td colspan="2">
        <form method="post" action="/reset">
          <input type="submit" value="Reset Demo Data">
        </form>
      </td></tr>
    </table>
  `
  );
}

export function renderMemberNotFound(memberId: string): string {
  return layout(
    "Member Search",
    `
    <table cellpadding="4" cellspacing="0" border="1" width="100%">
      <tr><td><div>No member found for ID ${escapeHtml(memberId)}.</div></td></tr>
      <tr><td><a href="/">Back to search</a></td></tr>
    </table>
  `
  );
}

export function renderMemberDetail(member: Member): string {
  const rows = member.accounts
    .map(
      (a) =>
        `<tr><td>${escapeHtml(a.type)}</td><td>${escapeHtml(a.id)}</td><td align="right">$${a.balance.toFixed(
          2
        )}</td></tr>`
    )
    .join("");
  const statusRow = member.eligible
    ? ""
    : `<tr><td colspan="3"><div>Status: Restricted &mdash; ${escapeHtml(
        member.ineligibleReason ?? ""
      )}</div></td></tr>`;
  return layout(
    `Member ${member.id}`,
    `
    <table cellpadding="4" cellspacing="0" border="1" width="100%">
      <tr><td colspan="3"><b>${escapeHtml(member.name)}</b> (ID ${escapeHtml(member.id)})</td></tr>
      ${statusRow}
      <tr><td><b>Type</b></td><td><b>Account #</b></td><td><b>Balance</b></td></tr>
      ${rows}
    </table>
    <p><a href="/members/${encodeURIComponent(member.id)}/accounts/new">Open Sub-Account</a></p>
    <p><a href="/">Back to search</a></p>
  `
  );
}

export function renderIneligible(member: Member): string {
  return layout(
    "Open Sub-Account",
    `
    <table cellpadding="4" cellspacing="0" border="1" width="100%">
      <tr><td><div>Member ${escapeHtml(member.name)} is not eligible to open new accounts.</div></td></tr>
      <tr><td><div>${escapeHtml(member.ineligibleReason ?? "")}</div></td></tr>
      <tr><td><a href="/members/${encodeURIComponent(member.id)}">Back to member</a></td></tr>
    </table>
  `
  );
}

export function renderOpenAccountForm(
  member: Member,
  opts?: { error?: string; accountType?: string; initialDeposit?: string }
): string {
  const errorRow = opts?.error
    ? `<tr><td colspan="2"><div>${escapeHtml(opts.error)}</div></td></tr>`
    : "";
  return layout(
    "Open Sub-Account",
    `
    <table cellpadding="4" cellspacing="0" border="1" width="100%">
      <tr><td colspan="2"><b>Open Sub-Account for ${escapeHtml(member.name)}</b></td></tr>
      ${errorRow}
      <form method="post" action="/members/${encodeURIComponent(member.id)}/accounts/new">
        <tr><td width="140">Account Type</td><td>
          <select name="accountType">
            <option value="savings" ${opts?.accountType === "savings" ? "selected" : ""}>Savings</option>
            <option value="checking" ${opts?.accountType === "checking" ? "selected" : ""}>Checking</option>
          </select>
        </td></tr>
        <tr><td>Initial Deposit</td><td>
          <input type="text" name="initialDeposit" value="${escapeHtml(opts?.initialDeposit ?? "")}" size="10">
        </td></tr>
        <tr><td colspan="2"><input type="submit" value="Continue"></td></tr>
      </form>
      <tr><td colspan="2"><a href="/members/${encodeURIComponent(member.id)}">Cancel</a></td></tr>
    </table>
  `
  );
}

export function renderReviewPage(member: Member, accountType: string, initialDeposit: number): string {
  return layout(
    "Review New Sub-Account",
    `
    <table cellpadding="4" cellspacing="0" border="1" width="100%">
      <tr><td colspan="2"><b>Review New Sub-Account</b></td></tr>
      <tr><td width="140">Member</td><td>${escapeHtml(member.name)} (${escapeHtml(member.id)})</td></tr>
      <tr><td>Account Type</td><td>${escapeHtml(accountType)}</td></tr>
      <tr><td>Initial Deposit</td><td>$${initialDeposit.toFixed(2)}</td></tr>
      <form method="post" action="/members/${encodeURIComponent(member.id)}/accounts/confirm">
        <input type="hidden" name="accountType" value="${escapeHtml(accountType)}">
        <input type="hidden" name="initialDeposit" value="${initialDeposit}">
        <tr><td colspan="2">
          <input type="submit" value="Confirm & Open Account">
        </td></tr>
      </form>
      <tr><td colspan="2"><a href="/members/${encodeURIComponent(member.id)}/accounts/new">Back</a></td></tr>
    </table>
  `
  );
}

export function renderConfirmationPage(member: Member, account: Account, confirmationId: string): string {
  return layout(
    "Account Opened",
    `
    <table cellpadding="4" cellspacing="0" border="1" width="100%">
      <tr><td colspan="2"><h2>Account Opened</h2></td></tr>
      <tr><td width="160">Member</td><td>${escapeHtml(member.name)} (${escapeHtml(member.id)})</td></tr>
      <tr><td>New Account Number</td><td>${escapeHtml(account.id)}</td></tr>
      <tr><td>Account Type</td><td>${escapeHtml(account.type)}</td></tr>
      <tr><td>Initial Deposit</td><td>$${account.balance.toFixed(2)}</td></tr>
      <tr><td>Confirmation ID</td><td>${escapeHtml(confirmationId)}</td></tr>
      <tr><td colspan="2"><a href="/members/${encodeURIComponent(member.id)}">Back to member</a></td></tr>
    </table>
  `
  );
}
