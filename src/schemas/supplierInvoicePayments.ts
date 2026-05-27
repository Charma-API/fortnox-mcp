import { z } from "zod";
import { ResponseFormat, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";

/**
 * Schema for listing supplier invoice payments
 */
export const ListSupplierInvoicePaymentsSchema = z.object({
  limit: z.number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe("Maximum number of results to return (1-100)"),
  page: z.number()
    .int()
    .min(1)
    .default(1)
    .describe("Page number for pagination"),
  supplier_invoice_number: z.string()
    .max(50)
    .optional()
    .describe("Filter by linked supplier invoice number"),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter payments from this payment date (YYYY-MM-DD)"),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Filter payments to this payment date (YYYY-MM-DD)"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type ListSupplierInvoicePaymentsInput = z.infer<typeof ListSupplierInvoicePaymentsSchema>;

/**
 * Schema for getting a single supplier invoice payment
 */
export const GetSupplierInvoicePaymentSchema = z.object({
  number: z.string()
    .min(1)
    .describe("The supplier invoice payment number to retrieve"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type GetSupplierInvoicePaymentInput = z.infer<typeof GetSupplierInvoicePaymentSchema>;
