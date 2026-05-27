import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fortnoxRequest, fortnoxRequestBinary } from "../services/api.js";
import { ResponseFormat } from "../constants.js";
import { buildToolResponse, buildErrorResponse } from "../services/formatters.js";
import {
  ListSupplierInvoiceFilesSchema,
  DownloadArchiveFileSchema,
  type ListSupplierInvoiceFilesInput,
  type DownloadArchiveFileInput
} from "../schemas/supplierInvoiceFiles.js";

// API response types
interface FortnoxSupplierInvoiceFileConnection {
  FileId: string;
  Name: string;
  SupplierInvoiceNumber: string;
  SupplierName?: string;
  "@url"?: string;
}

interface SupplierInvoiceFileConnectionListResponse {
  SupplierInvoiceFileConnections: FortnoxSupplierInvoiceFileConnection[];
}

interface SupplierInvoiceFileSummary {
  file_id: string;
  name: string;
  supplier_invoice_number: string;
  supplier_name: string | null;
}

interface SupplierInvoiceFileListOutput {
  supplier_invoice_number: string;
  count: number;
  files: SupplierInvoiceFileSummary[];
  [key: string]: unknown;
}

interface ArchiveFileDownloadOutput {
  file_id: string;
  mime_type: string;
  size_bytes: number;
  encoding: "base64";
  [key: string]: unknown;
}

/**
 * Register supplier-invoice file attachment tools
 */
export function registerSupplierInvoiceFileTools(server: McpServer): void {
  // List file attachments for a supplier invoice
  server.registerTool(
    "fortnox_list_supplier_invoice_files",
    {
      title: "List Supplier Invoice File Attachments",
      description: `List PDF/archive files attached to a specific supplier invoice.

Args:
  - supplier_invoice_number (string): The supplier invoice given number (required)
  - response_format ('markdown' | 'json'): Output format

Returns:
  List of file connections with FileId (use with fortnox_download_archive_file) and original Name.

Typical use:
  1. fortnox_get_supplier_invoice → note the given_number
  2. fortnox_list_supplier_invoice_files with that number → get FileId(s)
  3. fortnox_download_archive_file with each FileId → fetch the actual PDF`,
      inputSchema: ListSupplierInvoiceFilesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: ListSupplierInvoiceFilesInput) => {
      try {
        const response = await fortnoxRequest<SupplierInvoiceFileConnectionListResponse>(
          "/3/supplierinvoicefileconnections",
          "GET",
          undefined,
          { supplierinvoicenumber: params.supplier_invoice_number }
        );

        // Defensive client-side filter: the Fortnox API sometimes ignores
        // unknown query params and returns the full list.
        const files = (response.SupplierInvoiceFileConnections || []).filter(
          (c) =>
            String(c.SupplierInvoiceNumber) ===
            String(params.supplier_invoice_number)
        );

        const structured: SupplierInvoiceFileListOutput = {
          supplier_invoice_number: params.supplier_invoice_number,
          count: files.length,
          files: files.map((f) => ({
            file_id: f.FileId,
            name: f.Name,
            supplier_invoice_number: f.SupplierInvoiceNumber,
            supplier_name: f.SupplierName || null
          }))
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(structured, null, 2);
        } else if (files.length === 0) {
          textContent = `No file attachments found for supplier invoice #${params.supplier_invoice_number}.`;
        } else {
          const lines = [
            `# File attachments for supplier invoice #${params.supplier_invoice_number}`,
            "",
            `Found **${files.length}** file(s). Use \`fortnox_download_archive_file\` with the FileId to download.`,
            "",
            "| FileId | Name | Supplier |",
            "|--------|------|----------|"
          ];
          for (const f of files) {
            lines.push(
              `| \`${f.FileId}\` | ${f.Name || "-"} | ${f.SupplierName || "-"} |`
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

  // Download a file from the Fortnox archive
  server.registerTool(
    "fortnox_download_archive_file",
    {
      title: "Download Fortnox Archive File",
      description: `Download a file from the Fortnox archive by FileId and return it as an embedded base64 resource.

Use after fortnox_list_supplier_invoice_files to fetch the actual PDF attached
to a supplier invoice. Works for any file in the Fortnox archive (inbox,
supplier-invoice attachments, customer-invoice attachments, etc).

Args:
  - file_id (string): The archive FileId (required)
  - max_bytes (number): Safety cap; fails rather than returning larger payloads (default 5 MB, max 10 MB)

Returns:
  An MCP resource with the file's mimeType and the bytes as a base64 blob,
  plus a structured summary with size and content type.

Note: requires the 'archive' Fortnox scope on the integration.`,
      inputSchema: DownloadArchiveFileSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: DownloadArchiveFileInput) => {
      try {
        const file = await fortnoxRequestBinary(
          `/3/archive/${encodeURIComponent(params.file_id)}`
        );

        if (file.contentLength > params.max_bytes) {
          return buildErrorResponse(
            new Error(
              `File too large (${file.contentLength.toLocaleString()} bytes > ${params.max_bytes.toLocaleString()} byte limit). ` +
                `Raise max_bytes (up to 10,000,000) or download outside MCP.`
            )
          );
        }

        const base64 = file.data.toString("base64");
        const summary: ArchiveFileDownloadOutput = {
          file_id: params.file_id,
          mime_type: file.contentType,
          size_bytes: file.contentLength,
          encoding: "base64"
        };

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Downloaded file ${params.file_id} ` +
                `(${file.contentType}, ${file.contentLength.toLocaleString()} bytes). ` +
                `Embedded as resource blob below.`
            },
            {
              type: "resource" as const,
              resource: {
                uri: `fortnox-archive://${params.file_id}`,
                mimeType: file.contentType,
                blob: base64
              }
            }
          ],
          structuredContent: summary
        };
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );
}
