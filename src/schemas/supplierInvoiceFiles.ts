import { z } from "zod";
import { ResponseFormat } from "../constants.js";

/**
 * Schema for listing file attachments on a supplier invoice
 */
export const ListSupplierInvoiceFilesSchema = z.object({
  supplier_invoice_number: z.string()
    .min(1)
    .describe("The supplier invoice given number to list file attachments for"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' or 'json'")
}).strict();

export type ListSupplierInvoiceFilesInput = z.infer<typeof ListSupplierInvoiceFilesSchema>;

/**
 * Schema for downloading a file from the Fortnox archive
 *
 * The default max_bytes (5 MB) is large enough for typical supplier-invoice
 * PDFs but caps the inline blob to keep MCP responses manageable.
 */
export const DownloadArchiveFileSchema = z.object({
  file_id: z.string()
    .min(1)
    .describe("Archive FileId (typically from fortnox_list_supplier_invoice_files)"),
  max_bytes: z.number()
    .int()
    .min(1024)
    .max(10_000_000)
    .default(5_000_000)
    .describe("Safety cap on payload size; fail rather than return larger files inline (default 5 MB, max 10 MB)")
}).strict();

export type DownloadArchiveFileInput = z.infer<typeof DownloadArchiveFileSchema>;
