import { Router } from "express";
import { findMember, openAccount, resetState, MIN_INITIAL_DEPOSIT } from "./store";
import {
  renderSearchPage,
  renderMemberNotFound,
  renderMemberDetail,
  renderIneligible,
  renderOpenAccountForm,
  renderReviewPage,
  renderConfirmationPage,
} from "./views";
import { Account } from "./types";

export const router = Router();

router.get("/", (_req, res) => {
  res.send(renderSearchPage());
});

// Search form submits here; redirects to the canonical /members/:id route
// when found, renders the not-found business outcome in place otherwise.
router.get("/members", (req, res) => {
  const memberId = String(req.query.memberId ?? "").trim();
  const member = findMember(memberId);
  if (!member) {
    res.status(200).send(renderMemberNotFound(memberId));
    return;
  }
  res.redirect(`/members/${encodeURIComponent(member.id)}`);
});

router.get("/members/:id", (req, res) => {
  const member = findMember(req.params.id);
  if (!member) {
    res.status(200).send(renderMemberNotFound(req.params.id));
    return;
  }
  res.send(renderMemberDetail(member));
});

router.get("/members/:id/accounts/new", (req, res) => {
  const member = findMember(req.params.id);
  if (!member) {
    res.status(200).send(renderMemberNotFound(req.params.id));
    return;
  }
  if (!member.eligible) {
    res.status(200).send(renderIneligible(member));
    return;
  }
  res.send(renderOpenAccountForm(member));
});

function parseAccountType(value: unknown): Account["type"] | null {
  return value === "savings" || value === "checking" ? value : null;
}

// Step 1 of 2: validate and show a review/confirmation screen. Does not
// mutate state yet.
router.post("/members/:id/accounts/new", (req, res) => {
  const member = findMember(req.params.id);
  if (!member) {
    res.status(200).send(renderMemberNotFound(req.params.id));
    return;
  }
  if (!member.eligible) {
    res.status(200).send(renderIneligible(member));
    return;
  }

  const rawAccountType = String(req.body.accountType ?? "");
  const rawDeposit = String(req.body.initialDeposit ?? "");
  const accountType = parseAccountType(rawAccountType);
  const deposit = Number(rawDeposit);

  if (!accountType) {
    res.status(200).send(
      renderOpenAccountForm(member, {
        error: "Select a valid account type.",
        accountType: rawAccountType,
        initialDeposit: rawDeposit,
      })
    );
    return;
  }
  if (!rawDeposit || Number.isNaN(deposit) || deposit < MIN_INITIAL_DEPOSIT) {
    res.status(200).send(
      renderOpenAccountForm(member, {
        error: `Initial deposit must be a number of at least $${MIN_INITIAL_DEPOSIT.toFixed(2)}.`,
        accountType,
        initialDeposit: rawDeposit,
      })
    );
    return;
  }

  res.send(renderReviewPage(member, accountType, deposit));
});

// Step 2 of 2: the actual irreversible action. Re-validates defensively
// (never trusts the hidden fields blindly) before mutating store state.
router.post("/members/:id/accounts/confirm", (req, res) => {
  const member = findMember(req.params.id);
  if (!member) {
    res.status(200).send(renderMemberNotFound(req.params.id));
    return;
  }
  if (!member.eligible) {
    res.status(200).send(renderIneligible(member));
    return;
  }

  const accountType = parseAccountType(req.body.accountType);
  const deposit = Number(req.body.initialDeposit ?? "");

  if (!accountType || Number.isNaN(deposit) || deposit < MIN_INITIAL_DEPOSIT) {
    res.status(200).send(
      renderOpenAccountForm(member, {
        error: "Could not confirm the request — please re-enter account details.",
      })
    );
    return;
  }

  const { account, confirmationId } = openAccount(member.id, accountType, deposit);
  res.send(renderConfirmationPage(member, account, confirmationId));
});

router.post("/reset", (_req, res) => {
  resetState();
  res.redirect("/");
});
