# ADR 0034: Customer support tickets

- Status: Accepted
- Date: 2026-11-27

## Context

Tickets, inquiries, seller responses, admin intervention, status, attachments, conversation
history, access permissions. The user chose **order tickets to the seller**.

## Decision

- A customer opens a ticket about one store's part of an order (it goes to that seller,
  `AWAITING_SELLER`) or a general inquiry (marketplace support, `AWAITING_SUPPORT`).
- Seller teams with `seller.support.manage` see and answer their tickets only. Staff with
  `support.read` see all; `support.manage` can reply, join, take over (customer replies then go
  to support), assign and set priority.
- Status follows who must act next (`AWAITING_SELLER` / `AWAITING_SUPPORT` /
  `AWAITING_CUSTOMER`), plus `RESOLVED` and `CLOSED` (no replies; reopen allowed).
- `support_messages` are append-only; internal notes are visible to the seller team and staff,
  never to the customer. System lines record status changes and take-overs.
- Attachments: up to 5 images or PDFs (5 MB each) per message, type checked from the bytes,
  stored privately and streamed only to people who can see the message.
- Every read and write is scoped in the query (not found for others), and staff actions are
  audited. Updates notify the other side (SUPPORT_TICKET_UPDATED).
