import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fortnoxRequest } from "../services/api.js";
import { ResponseFormat } from "../constants.js";
import {
  buildToolResponse,
  buildErrorResponse,
  formatMoney,
  formatDisplayDate,
  formatPaginationInfo,
  buildPaginationMeta
} from "../services/formatters.js";
import {
  ListSupplierInvoicePaymentsSchema,
  GetSupplierInvoicePaymentSchema,
  type ListSupplierInvoicePaymentsInput,
  type GetSupplierInvoicePaymentInput
} from "../schemas/supplierInvoicePayments.js";

// API response types
interface FortnoxSupplierInvoicePayment {
  Number?: number | string;
  PaymentDate?: string;
  InvoiceNumber?: string;
  InvoiceSupplierNumber?: string;
  InvoiceSupplierName?: string;
  InvoiceDueDate?: string;
  InvoiceOCR?: string;
  InvoiceTotal?: string;
  Amount?: number;
  AmountCurrency?: number;
  Currency?: string;
  CurrencyRate?: number;
  CurrencyUnit?: number;
  ModeOfPayment?: string;
  ModeOfPaymentAccount?: number;
  Source?: string;
  Information?: string;
  Booked?: boolean;
  VoucherNumber?: number;
  VoucherSeries?: string;
  VoucherYear?: number;
  "@url"?: string;
}

interface SupplierInvoicePaymentListResponse {
  SupplierInvoicePayments: FortnoxSupplierInvoicePayment[];
  MetaInformation?: {
    "@TotalResources": number;
    "@TotalPages": number;
    "@CurrentPage": number;
  };
}

interface SupplierInvoicePaymentResponse {
  SupplierInvoicePayment: FortnoxSupplierInvoicePayment;
}

function paymentToSummary(p: FortnoxSupplierInvoicePayment) {
  return {
    number: p.Number ?? null,
    payment_date: p.PaymentDate || null,
    invoice_number: p.InvoiceNumber || null,
    supplier_number: p.InvoiceSupplierNumber || null,
    supplier_name: p.InvoiceSupplierName || null,
    amount: p.Amount ?? 0,
    currency: p.Currency || "SEK",
    mode_of_payment: p.ModeOfPayment || null,
    booked: p.Booked ?? false,
    voucher_series: p.VoucherSeries || null,
    voucher_number: p.VoucherNumber ?? null,
    voucher_year: p.VoucherYear ?? null
  };
}

/**
 * Register supplier-invoice payment tools (accounts payable settlement records)
 */
export function registerSupplierInvoicePaymentTools(server: McpServer): void {
  // List supplier invoice payments
  server.registerTool(
    "fortnox_list_supplier_invoice_payments",
    {
      title: "List Supplier Invoice Payments",
      description: `List recorded payments made on supplier invoices (accounts payable settlements).

Useful for reconciling against the bank account, seeing when invoices were
actually paid (vs just booked), and grouping spend by mode of payment.

Args:
  - limit (number): Max results per page, 1-100 (default: 20)
  - page (number): Page number for pagination (default: 1)
  - supplier_invoice_number (string): Filter by a specific invoice number
  - from_date (string): Filter payments with payment date >= YYYY-MM-DD
  - to_date (string): Filter payments with payment date <= YYYY-MM-DD
  - response_format ('markdown' | 'json'): Output format

Returns:
  List of payments with payment date, invoice/supplier, amount, mode of payment,
  and the linked voucher (series + number + year).`,
      inputSchema: ListSupplierInvoicePaymentsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: ListSupplierInvoicePaymentsInput) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {
          limit: params.limit,
          page: params.page,
          supplierinvoicenumber: params.supplier_invoice_number,
          fromdate: params.from_date,
          todate: params.to_date
        };

        const response = await fortnoxRequest<SupplierInvoicePaymentListResponse>(
          "/3/supplierinvoicepayments",
          "GET",
          undefined,
          queryParams
        );

        const payments = (response.SupplierInvoicePayments || []).map(paymentToSummary);
        const total = response.MetaInformation?.["@TotalResources"] ?? payments.length;

        const structured = {
          pagination: buildPaginationMeta(total, params.page, params.limit, payments.length),
          payments
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(structured, null, 2);
        } else if (payments.length === 0) {
          textContent = "# Supplier Invoice Payments\n\nNo payments found for the given filters.";
        } else {
          const lines = [
            "# Supplier Invoice Payments",
            "",
            formatPaginationInfo(total, params.page, params.limit, payments.length),
            "",
            "| # | Payment Date | Invoice | Supplier | Amount | Method | Booked |",
            "|---|--------------|---------|----------|--------|--------|--------|"
          ];
          for (const p of payments) {
            lines.push(
              `| ${p.number ?? "-"} | ${formatDisplayDate(p.payment_date || undefined)} | ${p.invoice_number || "-"} | ${p.supplier_name || p.supplier_number || "-"} | ${formatMoney(p.amount, p.currency)} | ${p.mode_of_payment || "-"} | ${p.booked ? "Yes" : "No"} |`
            );
          }
          textContent = lines.join("\n");
        }

        return buildToolResponse(textContent, structured);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Get a single supplier invoice payment
  server.registerTool(
    "fortnox_get_supplier_invoice_payment",
    {
      title: "Get Supplier Invoice Payment",
      description: `Retrieve full details for a single supplier invoice payment by its number.

Args:
  - number (string): The supplier invoice payment number (required)
  - response_format ('markdown' | 'json'): Output format

Returns:
  Payment details: dates, amount, currency, mode of payment, linked invoice/supplier,
  and the bookkeeping voucher (series + number + year) if booked.`,
      inputSchema: GetSupplierInvoicePaymentSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: GetSupplierInvoicePaymentInput) => {
      try {
        const response = await fortnoxRequest<SupplierInvoicePaymentResponse>(
          `/3/supplierinvoicepayments/${encodeURIComponent(params.number)}`
        );

        const payment = response.SupplierInvoicePayment;
        const summary = paymentToSummary(payment);

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(summary, null, 2);
        } else {
          const lines = [
            `# Supplier Invoice Payment #${summary.number ?? "-"}`,
            "",
            `**Status**: ${summary.booked ? "BOOKED" : "DRAFT"}`,
            "",
            "## Payment",
            `- **Date**: ${formatDisplayDate(summary.payment_date || undefined)}`,
            `- **Amount**: ${formatMoney(summary.amount, summary.currency)}`,
            `- **Mode of payment**: ${summary.mode_of_payment || "-"}`,
            "",
            "## Invoice",
            `- **Invoice number**: ${summary.invoice_number || "-"}`,
            `- **Supplier**: ${summary.supplier_name || "-"} (${summary.supplier_number || "-"})`,
            ""
          ];
          if (summary.voucher_number !== null) {
            lines.push(
              "## Bookkeeping voucher",
              `- **Series**: ${summary.voucher_series || "-"}`,
              `- **Number**: ${summary.voucher_number}`,
              `- **Year**: ${summary.voucher_year ?? "-"}`
            );
          }
          textContent = lines.join("\n");
        }

        return buildToolResponse(textContent, summary);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );
}
