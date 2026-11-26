import {
  toDisplayError,
  useAccountLedger,
  useCodReport,
  useCommissionPreview,
  useCommissionReport,
  useCommissionRules,
  useExpenses,
  useFinanceReconciliation,
  useJournal,
  useJournals,
  useLedgerAccounts,
  useRefundReport,
  useRevenueReport,
  useSettlementReport,
  useTaxProfilesToVerify,
  useTaxRules,
  useTrialBalance,
} from '@marketplace/api-client';
import {
  ledgerKindLabel,
  REFUND_REASON_LABELS,
  type RefundReason,
} from '@marketplace/shared-types';
import {
  Amount,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatMoney,
  Input,
  Label,
  PageHeader,
  PromptDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@marketplace/ui';
import {
  COMMISSION_SCOPES,
  COMMISSION_TYPES,
  type CommissionRuleDetail,
  type CommissionScope,
  type CommissionType,
  type ExpenseDto,
  type JournalSummary,
  type RuleState,
  type SellerTaxProfile,
  TAX_APPLIES_TO,
  type TaxRuleDto,
} from '@marketplace/validation';
import { BookOpenIcon, PercentIcon, ReceiptIcon } from 'lucide-react';
import { type ChangeEvent, type ReactNode, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { formatDateTime } from '../../lib/format';
import { Loaded, Pager, PeriodPicker } from './finance-common';
import {
  manilaToday,
  monthStart,
  orderLink,
  PAGE_SIZE,
  pageOf,
  useCan,
  useFinanceRun,
} from './finance-utils';

const SCOPE_LABELS: Record<CommissionScope, string> = {
  DEFAULT: 'Default',
  CATEGORY: 'Category',
  SELLER: 'Seller',
  SELLER_CATEGORY: 'Seller in a category',
  PRODUCT: 'Product',
};
const TYPE_LABELS: Record<CommissionType, string> = {
  PERCENTAGE: 'Percentage',
  FIXED: 'Fixed per unit',
  EXEMPT: 'Exemption',
};
const STATE_VARIANT: Record<RuleState, 'success' | 'secondary' | 'outline'> = {
  CURRENT: 'success',
  SCHEDULED: 'secondary',
  ENDED: 'outline',
};
const STATE_LABEL: Record<RuleState, string> = {
  CURRENT: 'In force',
  SCHEDULED: 'Scheduled',
  ENDED: 'Ended',
};

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

// ---- Commission rules -------------------------------------------------------------------------------

const ruleTarget = (r: CommissionRuleDetail) =>
  r.scope === 'DEFAULT'
    ? 'All products'
    : [r.seller?.name, r.category ? r.category.path.join(' › ') : null, r.product?.name]
        .filter(Boolean)
        .join(' · ');
const ruleValue = (r: CommissionRuleDetail) =>
  r.type === 'EXEMPT'
    ? 'No commission'
    : r.type === 'FIXED'
      ? `${formatMoney(r.fixedAmount)} per unit`
      : `${Number(r.ratePercent)}%`;

/** Commission rules: precedence, versions (never edited), exemptions and a preview per product. */
export function CommissionRulesPage() {
  const [state, setState] = useState<RuleState | 'ALL'>('CURRENT');
  const [scope, setScope] = useState<CommissionScope | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const rules = useCommissionRules({
    state: state === 'ALL' ? undefined : state,
    scope: scope === 'ALL' ? undefined : scope,
    page,
    pageSize: PAGE_SIZE,
  });
  const can = useCan();
  const { run } = useFinanceRun();
  const [open, setOpen] = useState(false);
  const columns: DataTableColumn<CommissionRuleDetail>[] = [
    {
      id: 'scope',
      header: 'Applies to',
      cell: (r) => (
        <div>
          <p className="font-medium">{SCOPE_LABELS[r.scope]}</p>
          <p className="text-xs text-muted-foreground">{ruleTarget(r)}</p>
        </div>
      ),
    },
    {
      id: 'value',
      header: 'Commission',
      cell: (r) => (
        <div>
          {ruleValue(r)}
          {r.reason ? <p className="text-xs text-muted-foreground">{r.reason}</p> : null}
        </div>
      ),
    },
    {
      id: 'dates',
      header: 'Effective',
      hideOnMobile: true,
      cell: (r) => (
        <span className="text-xs">
          {formatDateTime(r.effectiveFrom)} →{' '}
          {r.effectiveTo ? formatDateTime(r.effectiveTo) : 'no end'}
        </span>
      ),
    },
    {
      id: 'state',
      header: 'State',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant={STATE_VARIANT[r.state]}>{STATE_LABEL[r.state]}</Badge>
          {r.state !== 'ENDED' &&
          r.scope !== 'DEFAULT' &&
          can('commission.manage') &&
          (r.type !== 'EXEMPT' || can('commission.exempt')) ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline">
                  End
                </Button>
              }
              title="End this rule now?"
              description="Orders already placed keep their commission; new orders use the next rule by precedence."
              confirmLabel="End rule"
              onConfirm={() =>
                run('Could not end the rule', 'Rule ended', (f) => f.admin.commission.end(r.id))
              }
            />
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Commission"
        description="Precedence: an exemption that matches wins; then product, seller in a category, seller, category (nearest), default. A change creates a new version; orders keep the rule and rate they were placed with."
        actions={
          can('commission.manage') ? (
            <Button onClick={() => setOpen(true)}>New rule</Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap gap-3">
        <div className="sm:w-48">
          <Select
            value={state}
            onValueChange={(v) => {
              setState(v as RuleState);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Rule state">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All rules</SelectItem>
              {(['CURRENT', 'SCHEDULED', 'ENDED'] as const).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:w-56">
          <Select
            value={scope}
            onValueChange={(v) => {
              setScope(v as CommissionScope);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Every scope</SelectItem>
              {COMMISSION_SCOPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SCOPE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DataTable
        label="Commission rules"
        columns={columns}
        rows={rules.data?.items}
        getRowId={(r) => r.id}
        isLoading={rules.isPending}
        error={toDisplayError(rules.error)}
        onRetry={() => void rules.refetch()}
        empty={{ icon: PercentIcon, title: 'No rules' }}
        pagination={pageOf(rules.data, page, setPage, rules.isFetching)}
      />
      <CommissionPreviewCard />
      <NewCommissionRuleDialog
        open={open}
        onOpenChange={setOpen}
        canExempt={can('commission.exempt')}
      />
    </div>
  );
}

function CommissionPreviewCard() {
  const [productId, setProductId] = useState('');
  const [asked, setAsked] = useState<string | undefined>();
  const preview = useCommissionPreview(asked);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Which rule applies?</CardTitle>
        <CardDescription>
          Paste a product id (from the product page) to see the rule in force now.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field id="preview-product" label="Product id">
            <Input
              id="preview-product"
              className="sm:w-96"
              value={productId}
              onChange={(e) => setProductId(e.target.value.trim())}
            />
          </Field>
          <Button variant="outline" onClick={() => setAsked(productId || undefined)}>
            Check
          </Button>
        </div>
        {preview.data ? (
          <p className="text-sm">
            <span className="font-medium">{preview.data.product.name}</span> (
            {preview.data.seller.name}, {preview.data.categoryPath.join(' › ')}):{' '}
            {preview.data.rule
              ? `${SCOPE_LABELS[preview.data.rule.scope]} rule, ${ruleValue(preview.data.rule)}`
              : 'no rule (0%)'}{' '}
            · on ₱1,000: {formatMoney(preview.data.exampleOn1000)}
          </p>
        ) : preview.isError ? (
          <p className="text-sm text-destructive">{toDisplayError(preview.error)?.message}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NewCommissionRuleDialog({
  open,
  onOpenChange,
  canExempt,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canExempt: boolean;
}) {
  const { run, pending } = useFinanceRun();
  const empty = {
    scope: 'CATEGORY' as CommissionScope,
    type: 'PERCENTAGE' as CommissionType,
    categoryId: '',
    sellerId: '',
    productId: '',
    ratePercent: '',
    fixedAmount: '',
    effectiveFrom: '',
    reason: '',
  };
  const [v, setV] = useState(empty);
  const needs = {
    categoryId: v.scope === 'CATEGORY' || v.scope === 'SELLER_CATEGORY',
    sellerId: v.scope === 'SELLER' || v.scope === 'SELLER_CATEGORY',
    productId: v.scope === 'PRODUCT',
  };
  const submit = () =>
    run('Could not create the rule', 'Rule created', (f) =>
      f.admin.commission.create({
        scope: v.scope,
        type: v.type,
        categoryId: needs.categoryId ? v.categoryId : null,
        sellerId: needs.sellerId ? v.sellerId : null,
        productId: needs.productId ? v.productId : null,
        ratePercent: v.type === 'PERCENTAGE' ? v.ratePercent : null,
        fixedAmount: v.type === 'FIXED' ? v.fixedAmount : null,
        effectiveFrom: v.effectiveFrom ? new Date(v.effectiveFrom).toISOString() : null,
        reason: v.reason.trim() || null,
      }),
    )
      .then(() => {
        onOpenChange(false);
        setV(empty);
      })
      .catch(() => undefined);
  const text = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New commission rule</DialogTitle>
          <DialogDescription>
            It ends the rule in force for the same target when it starts. Ids are on the seller,
            category and product pages.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="rule-scope" label="Applies to">
            <Select
              value={v.scope}
              onValueChange={(s) => setV({ ...v, scope: s as CommissionScope })}
            >
              <SelectTrigger id="rule-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMISSION_SCOPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SCOPE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="rule-type" label="Commission">
            <Select value={v.type} onValueChange={(t) => setV({ ...v, type: t as CommissionType })}>
              <SelectTrigger id="rule-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMISSION_TYPES.filter((t) => t !== 'EXEMPT' || canExempt).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {needs.sellerId ? (
            <Field id="rule-seller" label="Seller id">
              <Input id="rule-seller" value={v.sellerId} onChange={text('sellerId')} />
            </Field>
          ) : null}
          {needs.categoryId ? (
            <Field id="rule-category" label="Category id">
              <Input id="rule-category" value={v.categoryId} onChange={text('categoryId')} />
            </Field>
          ) : null}
          {needs.productId ? (
            <Field id="rule-product" label="Product id">
              <Input id="rule-product" value={v.productId} onChange={text('productId')} />
            </Field>
          ) : null}
          {v.type === 'PERCENTAGE' ? (
            <Field id="rule-rate" label="Rate (%)">
              <Input
                id="rule-rate"
                inputMode="decimal"
                value={v.ratePercent}
                onChange={text('ratePercent')}
              />
            </Field>
          ) : null}
          {v.type === 'FIXED' ? (
            <Field id="rule-fixed" label="Amount per unit (₱)">
              <Input
                id="rule-fixed"
                inputMode="decimal"
                value={v.fixedAmount}
                onChange={text('fixedAmount')}
              />
            </Field>
          ) : null}
          <Field id="rule-from" label="Starts (empty: now)">
            <Input
              id="rule-from"
              type="datetime-local"
              value={v.effectiveFrom}
              onChange={text('effectiveFrom')}
            />
          </Field>
          <Field
            id="rule-reason"
            label={v.type === 'EXEMPT' ? 'Reason (required)' : 'Reason (optional)'}
          >
            <Input id="rule-reason" value={v.reason} onChange={text('reason')} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => void submit()}>
            Create rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Taxes ------------------------------------------------------------------------------------------

const APPLIES_LABELS = {
  GOODS: 'Goods sold by sellers',
  MARKETPLACE_SERVICES: 'Marketplace services (commission, fees)',
  SELLER_REMITTANCE: 'Withholding on remittances to sellers',
} as const;
const REGISTRATION_LABELS = {
  ANY: 'Any seller',
  VAT_REGISTERED: 'VAT-registered sellers',
  NON_VAT: 'Non-VAT sellers',
} as const;

export function TaxesPage() {
  const [params] = useSearchParams();
  const rules = useTaxRules();
  const can = useCan();
  const { run } = useFinanceRun();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Taxes"
        description="Versioned tax rules per jurisdiction. No single VAT rate is assumed: goods follow the seller’s registration, the marketplace’s services and withholding have their own rules."
        actions={
          can('tax.manage') ? (
            <Button onClick={() => setOpen(true)}>New tax rule</Button>
          ) : undefined
        }
      />
      <Tabs defaultValue={params.get('tab') === 'sellers' ? 'sellers' : 'rules'}>
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="sellers">Seller tax profiles to verify</TabsTrigger>
        </TabsList>
        <TabsContent value="rules">
          <Loaded query={rules}>
            {(data) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead>
                    <TableHead>Applies to</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead className="hidden md:table-cell">Effective</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((r: TaxRuleDto) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <span className="font-mono">{r.code}</span> · {r.jurisdiction}
                        <span className="block text-xs text-muted-foreground">
                          {r.name}
                          {r.legalReference ? ` — ${r.legalReference}` : ''}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {APPLIES_LABELS[r.appliesTo]}
                        <span className="block text-xs text-muted-foreground">
                          {REGISTRATION_LABELS[r.sellerRegistration]}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {Number(r.ratePercent)}%
                        {Number(r.basePercent) !== 100 ? ` of ${Number(r.basePercent)}%` : ''}{' '}
                        {r.inclusive ? '(included)' : '(added)'}
                      </TableCell>
                      <TableCell className="hidden text-xs md:table-cell">
                        {formatDateTime(r.effectiveFrom)} →{' '}
                        {r.effectiveTo ? formatDateTime(r.effectiveTo) : 'no end'}
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge variant={STATE_VARIANT[r.state]}>{STATE_LABEL[r.state]}</Badge>
                          {r.state !== 'ENDED' && can('tax.manage') ? (
                            <ConfirmDialog
                              trigger={
                                <Button size="sm" variant="outline">
                                  End
                                </Button>
                              }
                              title={`End ${r.code}?`}
                              description="Without a rule in force, that tax is not applied to new orders or settlements."
                              confirmLabel="End rule"
                              destructive
                              onConfirm={() =>
                                run('Could not end the rule', 'Rule ended', (f) =>
                                  f.admin.taxes.end(r.id),
                                )
                              }
                            />
                          ) : null}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Loaded>
        </TabsContent>
        <TabsContent value="sellers">
          <TaxProfilesToVerify />
        </TabsContent>
      </Tabs>
      <NewTaxRuleDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function TaxProfilesToVerify() {
  const profiles = useTaxProfilesToVerify();
  const can = useCan();
  const { run } = useFinanceRun();
  const [until, setUntil] = useState('');
  return (
    <Loaded query={profiles}>
      {(data) =>
        data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every verified seller’s tax profile has been checked.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {data.items.map((t: SellerTaxProfile) => (
              <li
                key={t.sellerId}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <span>
                  <Link className="font-medium hover:underline" to={`/sellers/${t.sellerId}`}>
                    {t.businessName}
                  </Link>{' '}
                  · TIN <span className="font-mono">{t.tin ?? 'missing'}</span> ·{' '}
                  {t.vatRegistered ? 'VAT-registered' : 'non-VAT'}
                  <span className="block text-xs text-muted-foreground">
                    {t.taxRegisteredName ?? 'No registered name yet'} · documents:{' '}
                    {t.documents.map((d) => d.type).join(', ') || 'none'}
                  </span>
                </span>
                {can('tax.manage') ? (
                  <PromptDialog
                    trigger={<Button size="sm">Verify</Button>}
                    title="Verify the seller’s BIR registration"
                    description="Check the TIN and Certificate of Registration in the seller’s documents. Enter a date to accept a sworn declaration (no withholding until then)."
                    label="Note (optional)"
                    minLength={0}
                    confirmLabel="Verify"
                    onSubmit={(note) =>
                      run('Could not verify', 'Tax profile verified', (f) =>
                        f.admin.taxes.verify(t.sellerId, {
                          verified: true,
                          withholdingExemptUntil: until || null,
                          note: note || null,
                        }),
                      )
                    }
                  >
                    <Field
                      id={`exempt-${t.sellerId}`}
                      label="Withholding exemption until (optional)"
                    >
                      <Input
                        id={`exempt-${t.sellerId}`}
                        type="date"
                        value={until}
                        onChange={(e) => setUntil(e.target.value)}
                      />
                    </Field>
                  </PromptDialog>
                ) : null}
              </li>
            ))}
          </ul>
        )
      }
    </Loaded>
  );
}

function NewTaxRuleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { run, pending } = useFinanceRun();
  const empty = {
    code: '',
    name: '',
    jurisdiction: 'PH',
    appliesTo: 'GOODS' as (typeof TAX_APPLIES_TO)[number],
    sellerRegistration: 'VAT_REGISTERED' as keyof typeof REGISTRATION_LABELS,
    ratePercent: '',
    basePercent: '100',
    inclusive: true,
    legalReference: '',
  };
  const [v, setV] = useState(empty);
  const kind = v.appliesTo === 'SELLER_REMITTANCE' ? 'WITHHOLDING' : 'VAT';
  const submit = () =>
    run('Could not create the rule', 'Tax rule created', (f) =>
      f.admin.taxes.create({
        ...v,
        kind,
        inclusive: v.appliesTo === 'GOODS' ? v.inclusive : true,
        legalReference: v.legalReference || null,
      }),
    )
      .then(() => {
        onOpenChange(false);
        setV(empty);
      })
      .catch(() => undefined);
  const text = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New tax rule</DialogTitle>
          <DialogDescription>
            It replaces the rule in force for the same jurisdiction, taxed item and seller
            registration.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="tax-code" label="Code">
            <Input
              id="tax-code"
              value={v.code}
              onChange={text('code')}
              placeholder="PH-VAT-GOODS"
            />
          </Field>
          <Field id="tax-name" label="Name">
            <Input id="tax-name" value={v.name} onChange={text('name')} />
          </Field>
          <Field id="tax-applies" label="Applies to">
            <Select
              value={v.appliesTo}
              onValueChange={(a) => setV({ ...v, appliesTo: a as typeof v.appliesTo })}
            >
              <SelectTrigger id="tax-applies">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAX_APPLIES_TO.map((a) => (
                  <SelectItem key={a} value={a}>
                    {APPLIES_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="tax-reg" label="Sellers">
            <Select
              value={v.sellerRegistration}
              onValueChange={(r) =>
                setV({ ...v, sellerRegistration: r as typeof v.sellerRegistration })
              }
            >
              <SelectTrigger id="tax-reg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REGISTRATION_LABELS) as (keyof typeof REGISTRATION_LABELS)[]).map(
                  (r) => (
                    <SelectItem key={r} value={r}>
                      {REGISTRATION_LABELS[r]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field id="tax-rate" label="Rate (%)">
            <Input
              id="tax-rate"
              inputMode="decimal"
              value={v.ratePercent}
              onChange={text('ratePercent')}
            />
          </Field>
          <Field id="tax-base" label="Share of the amount taxed (%)">
            <Input
              id="tax-base"
              inputMode="decimal"
              value={v.basePercent}
              onChange={text('basePercent')}
            />
          </Field>
          {v.appliesTo === 'GOODS' ? (
            <Field id="tax-inclusive" label="Prices">
              <Select
                value={v.inclusive ? 'yes' : 'no'}
                onValueChange={(x) => setV({ ...v, inclusive: x === 'yes' })}
              >
                <SelectTrigger id="tax-inclusive">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Include the tax</SelectItem>
                  <SelectItem value="no">Tax added on top</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field id="tax-jur" label="Jurisdiction">
            <Input
              id="tax-jur"
              value={v.jurisdiction}
              onChange={text('jurisdiction')}
              maxLength={2}
            />
          </Field>
          <Field id="tax-ref" label="Legal reference">
            <Input id="tax-ref" value={v.legalReference} onChange={text('legalReference')} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => void submit()}>
            Create rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Ledger ----------------------------------------------------------------------------------------

export function LedgerPage() {
  const [tab, setTab] = useState('journals');
  const can = useCan();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ledger"
        description="Double-entry journals (posted ones never change; corrections are reversals) and the chart of accounts."
        actions={
          can('ledger.post') ? (
            <Button onClick={() => setOpen(true)}>Manual journal</Button>
          ) : undefined
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="journals">Journals</TabsTrigger>
          <TabsTrigger value="accounts">Chart of accounts</TabsTrigger>
        </TabsList>
        <TabsContent value="journals">
          <JournalList />
        </TabsContent>
        <TabsContent value="accounts">
          <AccountList />
        </TabsContent>
      </Tabs>
      <ManualJournalDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function JournalList() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [range, setRange] = useState({ from: monthStart(), to: manilaToday() });
  const journals = useJournals({
    page,
    pageSize: PAGE_SIZE,
    q: q.trim() || undefined,
    from: range.from,
    to: range.to,
  });
  const columns: DataTableColumn<JournalSummary>[] = [
    {
      id: 'ref',
      header: 'Journal',
      cell: (j) => (
        <Link to={`/finance/journals/${j.id}`} className="font-mono font-medium hover:underline">
          {j.reference}
          <span className="block font-sans text-xs text-muted-foreground">
            {formatDateTime(j.occurredAt)}
          </span>
        </Link>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      hideOnMobile: true,
      cell: (j) => (
        <span className="flex items-center gap-1">
          {j.type}
          {j.status === 'DRAFT' ? <Badge variant="warning">Draft</Badge> : null}
          {j.reversedBy ? <Badge variant="outline">Reversed</Badge> : null}
        </span>
      ),
    },
    {
      id: 'desc',
      header: 'Description',
      cell: (j) => <span className="text-sm">{j.description}</span>,
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: (j) => <span className="font-mono">{formatMoney(j.totalDebit)}</span>,
    },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <PeriodPicker
          from={range.from}
          to={range.to}
          onChange={(from, to) => {
            setRange({ from, to });
            setPage(1);
          }}
          idPrefix="journals"
        />
        <Input
          className="sm:w-64"
          placeholder="Reference or description"
          aria-label="Search journals"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <DataTable
        label="Journals"
        columns={columns}
        rows={journals.data?.items}
        getRowId={(j) => j.id}
        isLoading={journals.isPending}
        error={toDisplayError(journals.error)}
        onRetry={() => void journals.refetch()}
        empty={{ icon: BookOpenIcon, title: 'No journals in this period' }}
        pagination={pageOf(journals.data, page, setPage, journals.isFetching)}
      />
    </div>
  );
}

function AccountList() {
  const accounts = useLedgerAccounts();
  return (
    <Loaded query={accounts}>
      {(data) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Link className="hover:underline" to={`/finance/accounts/${a.code}`}>
                    <span className="font-mono">{a.code}</span> {a.name}
                  </Link>
                  {a.sellerSubledger ? (
                    <Badge variant="outline" className="ml-2">
                      Seller subledger
                    </Badge>
                  ) : null}
                  {!a.active ? (
                    <Badge variant="outline" className="ml-2">
                      Inactive
                    </Badge>
                  ) : null}
                  {a.description ? (
                    <span className="block text-xs text-muted-foreground">{a.description}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">{a.type.toLowerCase()}</TableCell>
                <TableCell className="text-right">
                  <Amount value={a.balance} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Loaded>
  );
}

function ManualJournalDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { run, pending } = useFinanceRun();
  const blank = { accountCode: '', debit: '', credit: '', sellerId: '', description: '' };
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(manilaToday());
  const [lines, setLines] = useState([{ ...blank }, { ...blank }]);
  const total = (k: 'debit' | 'credit') =>
    lines.reduce((s, l) => s + Math.round(Number(l[k] || 0) * 100), 0) / 100;
  const set = (i: number, k: keyof typeof blank, value: string) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, [k]: value } : l)));
  const submit = () =>
    run('Could not save the journal', 'Draft saved: post it from its page', (f) =>
      f.admin.ledger.createManual({
        description,
        occurredAt: date,
        lines: lines.map((l) => ({
          accountCode: l.accountCode,
          debit: l.debit || '0',
          credit: l.credit || '0',
          sellerId: l.sellerId || null,
          description: l.description || null,
        })),
      }),
    )
      .then(() => {
        onOpenChange(false);
        setLines([{ ...blank }, { ...blank }]);
        setDescription('');
      })
      .catch(() => undefined);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manual journal</DialogTitle>
          <DialogDescription>
            Saved as a draft. Total debits must equal total credits; seller payable accounts (21xx)
            need the seller id.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Field id="mj-desc" label="Description">
            <Input
              id="mj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field id="mj-date" label="Accounting date">
            <Input
              id="mj-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[6rem_1fr_1fr_1fr] gap-2">
              <Input
                aria-label={`Line ${i + 1} account`}
                placeholder="Account"
                value={l.accountCode}
                onChange={(e) => set(i, 'accountCode', e.target.value)}
              />
              <Input
                aria-label={`Line ${i + 1} debit`}
                placeholder="Debit"
                inputMode="decimal"
                value={l.debit}
                onChange={(e) => set(i, 'debit', e.target.value)}
              />
              <Input
                aria-label={`Line ${i + 1} credit`}
                placeholder="Credit"
                inputMode="decimal"
                value={l.credit}
                onChange={(e) => set(i, 'credit', e.target.value)}
              />
              <Input
                aria-label={`Line ${i + 1} seller`}
                placeholder="Seller id (21xx)"
                value={l.sellerId}
                onChange={(e) => set(i, 'sellerId', e.target.value)}
              />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines([...lines, { ...blank }])}>
            Add line
          </Button>
          <p
            className={`text-sm ${total('debit') === total('credit') ? 'text-muted-foreground' : 'text-destructive'}`}
          >
            Debits {formatMoney(String(total('debit')))} · credits{' '}
            {formatMoney(String(total('credit')))}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || total('debit') !== total('credit') || total('debit') === 0}
            onClick={() => void submit()}
          >
            Save draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function JournalPage() {
  const { journalId } = useParams();
  const journal = useJournal(journalId);
  const can = useCan();
  const { run } = useFinanceRun();
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Finance', to: '/finance' },
          { label: 'Ledger', to: '/finance/ledger' },
          { label: journal.data?.reference ?? 'Journal' },
        ]}
      />
      <Loaded query={journal}>
        {(j) => (
          <>
            <PageHeader
              title={`Journal ${j.reference}`}
              description={`${j.type} · ${j.description}`}
              actions={
                can('ledger.post') ? (
                  <>
                    {j.status === 'DRAFT' ? (
                      <>
                        <ConfirmDialog
                          trigger={<Button>Post</Button>}
                          title="Post this journal?"
                          description="Posted journals can never be edited or deleted, only reversed."
                          confirmLabel="Post"
                          onConfirm={() =>
                            run('Could not post', 'Journal posted', (f) =>
                              f.admin.ledger.post(j.id),
                            )
                          }
                        />
                        <ConfirmDialog
                          trigger={<Button variant="outline">Discard draft</Button>}
                          title="Discard this draft?"
                          description="Drafts are not part of the books."
                          confirmLabel="Discard"
                          destructive
                          onConfirm={() =>
                            run('Could not discard', 'Draft discarded', (f) =>
                              f.admin.ledger.discard(j.id),
                            ).then(() => window.history.back())
                          }
                        />
                      </>
                    ) : null}
                    {j.status === 'POSTED' && j.type === 'MANUAL' && !j.reversedBy ? (
                      <PromptDialog
                        trigger={<Button variant="outline">Reverse</Button>}
                        title="Reverse this journal"
                        label="Reason"
                        confirmLabel="Post reversal"
                        destructive
                        onSubmit={(reason) =>
                          run('Could not reverse', 'Reversal posted', (f) =>
                            f.admin.ledger.reverse(j.id, reason),
                          )
                        }
                      />
                    ) : null}
                  </>
                ) : undefined
              }
            />
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant={j.status === 'POSTED' ? 'success' : 'warning'}>
                {j.status === 'POSTED' ? 'Posted' : 'Draft'}
              </Badge>
              <span>{formatDateTime(j.occurredAt)}</span>
              {j.reversalOf ? (
                <Link className="underline" to={`/finance/journals/${j.reversalOf.id}`}>
                  Reverses {j.reversalOf.reference}
                </Link>
              ) : null}
              {j.reversedBy ? (
                <Link className="underline" to={`/finance/journals/${j.reversedBy.id}`}>
                  Reversed by {j.reversedBy.reference}
                </Link>
              ) : null}
              {j.createdBy ? <span>By {j.createdBy}</span> : null}
            </div>
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="hidden md:table-cell">Seller / order</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {j.entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          <Link
                            className="hover:underline"
                            to={`/finance/accounts/${e.account.code}`}
                          >
                            <span className="font-mono">{e.account.code}</span> {e.account.name}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden text-sm md:table-cell">
                          {e.seller ? (
                            <Link
                              className="hover:underline"
                              to={`/finance/balances/${e.seller.id}`}
                            >
                              {e.seller.name}
                            </Link>
                          ) : null}
                          {e.sellerOrder ? (
                            <span className="block">
                              {orderLink(e.sellerOrder.id, e.sellerOrder.number)}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">
                          {e.kind ? ledgerKindLabel(e.kind) : ''}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(e.debit) ? formatMoney(e.debit) : ''}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(e.credit) ? formatMoney(e.credit) : ''}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={3} className="font-medium">
                        Total
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatMoney(j.totalDebit)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatMoney(j.totalCredit)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </Loaded>
    </div>
  );
}

export function AccountLedgerPage() {
  const { code } = useParams();
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({ from: monthStart(), to: manilaToday() });
  const ledger = useAccountLedger(code, {
    page,
    pageSize: PAGE_SIZE,
    from: range.from,
    to: range.to,
  });
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Finance', to: '/finance' },
          { label: 'Ledger', to: '/finance/ledger' },
          { label: code ?? 'Account' },
        ]}
      />
      <Loaded query={ledger}>
        {(l) => (
          <>
            <PageHeader
              title={`${l.account.code} ${l.account.name}`}
              description={l.account.description ?? l.account.type.toLowerCase()}
            />
            <PeriodPicker
              from={range.from}
              to={range.to}
              onChange={(from, to) => {
                setRange({ from, to });
                setPage(1);
              }}
              idPrefix="account"
            />
            <p className="text-sm">
              Opening {formatMoney(l.openingBalance)} · closing {formatMoney(l.closingBalance)}
            </p>
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Journal</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {l.items.map((e) => (
                      <TableRow key={e.entryId}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {formatDateTime(e.occurredAt)}
                        </TableCell>
                        <TableCell className="text-sm">
                          <Link
                            className="font-mono hover:underline"
                            to={`/finance/journals/${e.journal.id}`}
                          >
                            {e.journal.reference}
                          </Link>{' '}
                          {e.description}
                          {e.seller ? (
                            <span className="block text-xs text-muted-foreground">
                              {e.seller.name}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(e.debit) ? formatMoney(e.debit) : ''}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(e.credit) ? formatMoney(e.credit) : ''}
                        </TableCell>
                        <TableCell className="text-right">
                          <Amount value={e.balance} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pager page={page} totalPages={l.totalPages} onChange={setPage} />
              </CardContent>
            </Card>
          </>
        )}
      </Loaded>
    </div>
  );
}

// ---- Expenses ---------------------------------------------------------------------------------------

export function ExpensesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'ALL' | ExpenseDto['status']>('ALL');
  const list = useExpenses({
    page,
    pageSize: PAGE_SIZE,
    status: status === 'ALL' ? undefined : status,
  });
  const can = useCan();
  const { run } = useFinanceRun();
  const [open, setOpen] = useState(false);
  const columns: DataTableColumn<ExpenseDto>[] = [
    {
      id: 'ref',
      header: 'Expense',
      cell: (e) => (
        <div>
          <p className="font-mono font-medium">{e.reference}</p>
          <p className="text-xs text-muted-foreground">{e.incurredOn}</p>
        </div>
      ),
    },
    {
      id: 'vendor',
      header: 'Vendor',
      cell: (e) => (
        <div>
          {e.vendorName}
          <p className="text-xs text-muted-foreground">{e.description}</p>
        </div>
      ),
    },
    {
      id: 'account',
      header: 'Account',
      hideOnMobile: true,
      cell: (e) => `${e.account.code} ${e.account.name}`,
    },
    {
      id: 'total',
      header: 'Total',
      cell: (e) => <span className="font-mono">{formatMoney(e.total)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (e) => (
        <span className="flex flex-wrap items-center gap-2">
          <Badge
            variant={e.status === 'PAID' ? 'success' : e.status === 'VOID' ? 'outline' : 'warning'}
          >
            {e.status.toLowerCase()}
          </Badge>
          {e.status === 'UNPAID' && can('ledger.post') ? (
            <>
              <PromptDialog
                trigger={
                  <Button size="sm" variant="outline">
                    Pay
                  </Button>
                }
                title="Record the payment"
                label="Bank reference"
                confirmLabel="Record"
                onSubmit={(ref) =>
                  run('Could not record', 'Expense paid', (f) => f.admin.expenses.pay(e.id, ref))
                }
              />
              <PromptDialog
                trigger={
                  <Button size="sm" variant="outline">
                    Void
                  </Button>
                }
                title="Void this expense"
                label="Reason"
                confirmLabel="Void"
                destructive
                onSubmit={(reason) =>
                  run('Could not void', 'Expense voided', (f) =>
                    f.admin.expenses.void(e.id, reason),
                  )
                }
              />
            </>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Marketplace bills (accounts payable). Recording one posts the expense and input VAT; paying it moves it out of the bank."
        actions={
          can('ledger.post') ? (
            <Button onClick={() => setOpen(true)}>Record expense</Button>
          ) : undefined
        }
      />
      <div className="sm:w-48">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as typeof status);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Expense status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All expenses</SelectItem>
            <SelectItem value="UNPAID">Unpaid</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
            <SelectItem value="VOID">Void</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DataTable
        label="Expenses"
        columns={columns}
        rows={list.data?.items}
        getRowId={(e) => e.id}
        isLoading={list.isPending}
        error={toDisplayError(list.error)}
        onRetry={() => void list.refetch()}
        empty={{ icon: ReceiptIcon, title: 'No expenses' }}
        pagination={pageOf(list.data, page, setPage, list.isFetching)}
      />
      <ExpenseDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function ExpenseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const accounts = useLedgerAccounts();
  const { run, pending } = useFinanceRun();
  const empty = {
    vendorName: '',
    vendorTin: '',
    description: '',
    accountCode: '5090',
    amount: '',
    inputVat: '0.00',
    invoiceNumber: '',
    incurredOn: manilaToday(),
    paidReference: '',
  };
  const [v, setV] = useState(empty);
  const text = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [k]: e.target.value });
  const submit = () =>
    run('Could not record the expense', 'Expense recorded', (f) =>
      f.admin.expenses.create({
        ...v,
        vendorTin: v.vendorTin || null,
        invoiceNumber: v.invoiceNumber || null,
        paidReference: v.paidReference || null,
      }),
    )
      .then(() => {
        onOpenChange(false);
        setV(empty);
      })
      .catch(() => undefined);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record an expense</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ex-vendor" label="Vendor">
            <Input id="ex-vendor" value={v.vendorName} onChange={text('vendorName')} />
          </Field>
          <Field id="ex-tin" label="Vendor TIN (optional)">
            <Input id="ex-tin" value={v.vendorTin} onChange={text('vendorTin')} />
          </Field>
          <Field id="ex-desc" label="Description">
            <Input id="ex-desc" value={v.description} onChange={text('description')} />
          </Field>
          <Field id="ex-account" label="Expense account">
            <Select value={v.accountCode} onValueChange={(c) => setV({ ...v, accountCode: c })}>
              <SelectTrigger id="ex-account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(accounts.data?.items ?? [])
                  .filter((a) => a.type === 'EXPENSE' && a.active)
                  .map((a) => (
                    <SelectItem key={a.code} value={a.code}>
                      {a.code} {a.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="ex-amount" label="Amount before VAT">
            <Input id="ex-amount" inputMode="decimal" value={v.amount} onChange={text('amount')} />
          </Field>
          <Field id="ex-vat" label="Input VAT">
            <Input id="ex-vat" inputMode="decimal" value={v.inputVat} onChange={text('inputVat')} />
          </Field>
          <Field id="ex-invoice" label="Vendor invoice number">
            <Input id="ex-invoice" value={v.invoiceNumber} onChange={text('invoiceNumber')} />
          </Field>
          <Field id="ex-date" label="Date">
            <Input id="ex-date" type="date" value={v.incurredOn} onChange={text('incurredOn')} />
          </Field>
          <Field id="ex-paid" label="Already paid: bank reference (optional)">
            <Input id="ex-paid" value={v.paidReference} onChange={text('paidReference')} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => void submit()}>
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Reports ----------------------------------------------------------------------------------------

function Rows({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <dl className="max-w-md text-sm">
      {rows.map(([label, value, strong]) => (
        <div
          key={label}
          className={`flex justify-between gap-3 py-1 ${strong ? 'font-semibold' : ''}`}
        >
          <dt>{label}</dt>
          <dd>
            <Amount value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'revenue';
  const [range, setRange] = useState({ from: monthStart(), to: manilaToday() });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting reports"
        description="From posted ledger lines for the period (Philippine calendar days)."
      />
      <PeriodPicker
        from={range.from}
        to={range.to}
        onChange={(from, to) => setRange({ from, to })}
        idPrefix="report"
      />
      <Tabs value={tab} onValueChange={(t) => setParams({ tab: t })}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="commission">Commission</TabsTrigger>
          <TabsTrigger value="refunds">Refunds</TabsTrigger>
          <TabsTrigger value="cod">COD</TabsTrigger>
          <TabsTrigger value="settlements">Settlements</TabsTrigger>
          <TabsTrigger value="trial-balance">Trial balance</TabsTrigger>
          <TabsTrigger value="checks">Checks</TabsTrigger>
        </TabsList>
        <TabsContent value="revenue">
          <RevenueReportView {...range} />
        </TabsContent>
        <TabsContent value="commission">
          <CommissionReportView {...range} />
        </TabsContent>
        <TabsContent value="refunds">
          <RefundReportView {...range} />
        </TabsContent>
        <TabsContent value="cod">
          <CodReportView {...range} />
        </TabsContent>
        <TabsContent value="settlements">
          <SettlementReportView {...range} />
        </TabsContent>
        <TabsContent value="trial-balance">
          <TrialBalanceView {...range} />
        </TabsContent>
        <TabsContent value="checks">
          <ChecksView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Range = { from: string; to: string };

function RevenueReportView({ from, to }: Range) {
  const report = useRevenueReport(from, to);
  return (
    <Loaded query={report}>
      {(r) => (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Income statement (marketplace books)</CardTitle>
              <CardDescription>
                Seller sales are not marketplace revenue; they are owed to sellers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Rows
                rows={[
                  ...r.revenue.map((x) => [`${x.code} ${x.label}`, x.amount] as [string, string]),
                  ['Total revenue', r.totalRevenue, true],
                ]}
              />
              <Rows
                rows={[
                  ...r.expenses.map((x) => [`${x.code} ${x.label}`, x.amount] as [string, string]),
                  ['Total expenses', r.totalExpenses, true],
                ]}
              />
              <Rows rows={[['Net income', r.netIncome, true]]} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Facilitated sales and taxes</CardTitle>
            </CardHeader>
            <CardContent>
              <Rows
                rows={[
                  ['Seller sales (GMV)', r.grossMerchandiseValue],
                  ['Output VAT (period)', r.outputVat],
                  ['Withholding tax (period)', r.withholdingTax],
                ]}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </Loaded>
  );
}

function CommissionReportView({ from, to }: Range) {
  const report = useCommissionReport(from, to);
  return (
    <Loaded query={report}>
      {(r) => (
        <div className="space-y-4">
          <Rows
            rows={[
              ['Sales', r.totals.sales],
              ['Commission charged', r.totals.commission],
              [
                'Commission returned',
                Number(r.totals.reversed) === 0 ? '0.00' : `-${r.totals.reversed}`,
              ],
              ['Net commission', r.totals.net, true],
            ]}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Seller</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="text-right">Net commission</TableHead>
                <TableHead className="text-right">Effective rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.rows.map((x) => (
                <TableRow key={x.seller.id}>
                  <TableCell>
                    <Link className="hover:underline" to={`/finance/balances/${x.seller.id}`}>
                      {x.seller.name}
                    </Link>
                  </TableCell>
                  <TableCell>{x.orders}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(x.sales)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(x.net)}</TableCell>
                  <TableCell className="text-right">{x.effectiveRate}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-sm font-medium">By rule type</p>
          <ul className="text-sm">
            {r.byScope.map((s) => (
              <li key={`${s.scope}-${s.type}`}>
                {SCOPE_LABELS[s.scope as CommissionScope] ?? s.scope} ·{' '}
                {TYPE_LABELS[s.type as CommissionType] ?? s.type}: {s.items} item(s),{' '}
                {formatMoney(s.commission)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Loaded>
  );
}

function RefundReportView({ from, to }: Range) {
  const report = useRefundReport(from, to);
  return (
    <Loaded query={report}>
      {(r) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reason</TableHead>
              <TableHead>Refunds</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Seller share</TableHead>
              <TableHead className="text-right">Marketplace share</TableHead>
              <TableHead className="text-right">Commission returned</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              ...r.rows.map((x) => ({
                ...x,
                label: REFUND_REASON_LABELS[x.reason as RefundReason] ?? x.reason,
              })),
              { ...r.totals, reason: 'TOTAL', label: 'Total' },
            ].map((x) => (
              <TableRow key={x.reason}>
                <TableCell className={x.reason === 'TOTAL' ? 'font-medium' : ''}>
                  {x.label}
                </TableCell>
                <TableCell>{x.count}</TableCell>
                <TableCell className="text-right font-mono">{formatMoney(x.amount)}</TableCell>
                <TableCell className="text-right font-mono">{formatMoney(x.sellerShare)}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatMoney(x.marketplaceShare)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatMoney(x.commissionReturned)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Loaded>
  );
}

function CodReportView({ from, to }: Range) {
  const report = useCodReport(from, to);
  return (
    <Loaded query={report}>
      {(r) => (
        <div className="space-y-3">
          <p className={`text-sm ${r.matches ? '' : 'text-destructive'}`}>
            Ledger COD receivable {formatMoney(r.ledgerReceivable)} · collections not yet remitted{' '}
            {formatMoney(r.operationalOutstanding)} —{' '}
            {r.matches ? 'reconciled' : 'difference to investigate'}.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Courier</TableHead>
                <TableHead className="text-right">Collected</TableHead>
                <TableHead className="text-right">Remitted (expected)</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead className="text-right">Outstanding now</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.rows.map((x) => (
                <TableRow key={x.carrier}>
                  <TableCell>{x.carrier}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(x.collected)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMoney(x.remittedExpected)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMoney(x.remittedReceived)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={x.difference} />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMoney(x.outstanding)} ({x.outstandingParcels})
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Loaded>
  );
}

function SettlementReportView({ from, to }: Range) {
  const report = useSettlementReport(from, to);
  return (
    <Loaded query={report}>
      {(r) => (
        <Rows
          rows={[
            [`Settlements (${r.settlements}), orders (${r.orders})`, r.netSettled, true],
            ['Sales settled', r.grossSales],
            ['Commission', r.commission],
            ['Payment and COD fees', r.paymentFees],
            ['Refunds', r.refunds],
            ['Withholding tax', r.withholdingTax],
            [`Payouts paid (${r.payoutsPaidCount})`, r.payoutsPaid, true],
          ]}
        />
      )}
    </Loaded>
  );
}

function TrialBalanceView({ from, to }: Range) {
  const report = useTrialBalance(from, to);
  return (
    <Loaded query={report}>
      {(r) => (
        <div className="space-y-2">
          <p className={`text-sm ${r.balanced ? '' : 'text-destructive'}`}>
            {r.balanced ? 'Debits equal credits.' : 'Out of balance!'}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Closing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.rows.map((x) => (
                <TableRow key={x.code}>
                  <TableCell>
                    <Link className="hover:underline" to={`/finance/accounts/${x.code}`}>
                      <span className="font-mono">{x.code}</span> {x.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={x.opening} />
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(x.debit)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(x.credit)}</TableCell>
                  <TableCell className="text-right">
                    <Amount value={x.closing} />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                <TableCell />
                <TableCell className="text-right font-mono font-medium">
                  {formatMoney(r.totalDebit)}
                </TableCell>
                <TableCell className="text-right font-mono font-medium">
                  {formatMoney(r.totalCredit)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </Loaded>
  );
}

function ChecksView() {
  const report = useFinanceReconciliation();
  return (
    <Loaded query={report}>
      {(r) => (
        <ul className="space-y-2">
          {r.checks.map((c) => (
            <li key={c.code} className="rounded-md border p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <Badge variant={c.ok ? 'success' : 'destructive'}>{c.ok ? 'OK' : 'Check'}</Badge>{' '}
                {c.label}
              </p>
              <p className="text-muted-foreground">{c.detail}</p>
              {c.items.length > 0 ? (
                <p className="text-xs">{c.items.map((i) => i.label).join(', ')}</p>
              ) : null}
            </li>
          ))}
          <li className="text-xs text-muted-foreground">Checked {formatDateTime(r.checkedAt)}</li>
        </ul>
      )}
    </Loaded>
  );
}
