const errorResponse = {
  description: "Request gagal.",
  $ref: "#/components/schemas/Error",
};

const uuidParams = (name = "id") => ({
  type: "object",
  required: [name],
  properties: {
    [name]: {
      type: "string",
      format: "uuid",
      description: "UUID resource.",
    },
  },
});

const apiSecurity = [{ ApiKeyAuth: [] }, { SessionCookie: [] }];
const sessionSecurity = [{ SessionCookie: [] }];

const routeDocumentation = {
  "GET /v1/health": {
    tags: ["System"],
    summary: "Periksa kesiapan service",
    description: "Endpoint publik untuk health check server, backend OCR, dan antrean.",
    operationId: "getHealth",
    security: [],
    response: {
      200: { $ref: "#/components/schemas/Health" },
      503: { $ref: "#/components/schemas/Health" },
    },
  },
  "GET /v1/ai/models": {
    tags: ["AI"],
    summary: "Daftar model AI",
    operationId: "listAiModels",
    security: apiSecurity,
    response: {
      200: { $ref: "#/components/schemas/AiModels" },
      401: errorResponse,
    },
  },
  "GET /v1/folders": {
    tags: ["Folders"],
    summary: "Daftar folder virtual",
    operationId: "listFolders",
    security: apiSecurity,
    response: {
      200: { $ref: "#/components/schemas/FolderCollection" },
      401: errorResponse,
    },
  },
  "POST /v1/folders": {
    tags: ["Folders"],
    summary: "Buat folder virtual",
    description: "Hanya tersedia melalui sesi dashboard yang sedang login.",
    operationId: "createFolder",
    security: sessionSecurity,
    body: { $ref: "#/components/schemas/FolderInput" },
    response: {
      201: {
        type: "object",
        required: ["folder"],
        properties: { folder: { $ref: "#/components/schemas/Folder" } },
      },
      400: errorResponse,
      403: errorResponse,
      409: errorResponse,
    },
  },
  "GET /v1/folders/:id": {
    tags: ["Folders"],
    summary: "Detail folder dan dokumennya",
    operationId: "getFolder",
    security: apiSecurity,
    params: uuidParams(),
    response: {
      200: {
        type: "object",
        required: ["folder", "jobs"],
        properties: {
          folder: { $ref: "#/components/schemas/Folder" },
          jobs: { type: "array", items: { $ref: "#/components/schemas/Job" } },
        },
      },
      401: errorResponse,
      404: errorResponse,
    },
  },
  "PATCH /v1/folders/:id": {
    tags: ["Folders"],
    summary: "Ubah nama folder",
    description: "Hanya tersedia melalui sesi dashboard yang sedang login.",
    operationId: "renameFolder",
    security: sessionSecurity,
    params: uuidParams(),
    body: { $ref: "#/components/schemas/FolderInput" },
    response: {
      200: {
        type: "object",
        required: ["folder"],
        properties: { folder: { $ref: "#/components/schemas/Folder" } },
      },
      400: errorResponse,
      403: errorResponse,
      404: errorResponse,
      409: errorResponse,
    },
  },
  "DELETE /v1/folders/:id": {
    tags: ["Folders"],
    summary: "Hapus folder virtual",
    description: "Dokumen tidak ikut dihapus. Hanya tersedia melalui sesi dashboard.",
    operationId: "deleteFolder",
    security: sessionSecurity,
    params: uuidParams(),
    response: {
      204: { type: "null", description: "Folder berhasil dihapus." },
      403: errorResponse,
      404: errorResponse,
    },
  },
  "POST /v1/jobs": {
    tags: ["Jobs"],
    summary: "Unggah PDF untuk diproses",
    operationId: "createJob",
    security: apiSecurity,
    consumes: ["multipart/form-data"],
    body: {
      type: "object",
      required: ["file"],
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Satu file PDF.",
        },
        folderId: {
          type: "string",
          format: "uuid",
          description: "Folder tujuan opsional.",
        },
      },
    },
    response: {
      202: {
        type: "object",
        required: ["job"],
        properties: { job: { $ref: "#/components/schemas/Job" } },
      },
      400: errorResponse,
      401: errorResponse,
      413: errorResponse,
      415: errorResponse,
    },
  },
  "POST /v1/queue/pause": {
    tags: ["Jobs"],
    summary: "Jeda antrean dokumen",
    description:
      "Menjeda pemrosesan antrean. Dokumen yang sedang berjalan diselesaikan, namun dokumen di antrean tidak diproses otomatis sampai dilanjutkan.",
    operationId: "pauseQueue",
    security: apiSecurity,
    response: {
      200: {
        type: "object",
        required: ["ok", "paused", "stats"],
        properties: {
          ok: { type: "boolean" },
          paused: { type: "boolean" },
          stats: { $ref: "#/components/schemas/QueueStats" },
        },
      },
      401: errorResponse,
    },
  },
  "POST /v1/queue/resume": {
    tags: ["Jobs"],
    summary: "Lanjutkan antrean dokumen",
    description: "Melanjutkan kembali pemrosesan antrean yang dijeda.",
    operationId: "resumeQueue",
    security: apiSecurity,
    response: {
      200: {
        type: "object",
        required: ["ok", "paused", "stats"],
        properties: {
          ok: { type: "boolean" },
          paused: { type: "boolean" },
          stats: { $ref: "#/components/schemas/QueueStats" },
        },
      },
      401: errorResponse,
    },
  },
  "GET /v1/jobs": {
    tags: ["Jobs"],
    summary: "Daftar semua job",
    operationId: "listJobs",
    security: apiSecurity,
    response: {
      200: {
        type: "object",
        required: ["jobs", "stats"],
        properties: {
          jobs: { type: "array", items: { $ref: "#/components/schemas/Job" } },
          stats: { $ref: "#/components/schemas/QueueStats" },
        },
      },
      401: errorResponse,
    },
  },
  "GET /v1/jobs/:id": {
    tags: ["Jobs"],
    summary: "Periksa status job",
    operationId: "getJob",
    security: apiSecurity,
    params: uuidParams(),
    response: {
      200: {
        type: "object",
        required: ["job"],
        properties: { job: { $ref: "#/components/schemas/Job" } },
      },
      401: errorResponse,
      404: errorResponse,
    },
  },
  "POST /v1/jobs/:id/cancel": {
    tags: ["Jobs"],
    summary: "Batalkan dokumen di antrean atau yang sedang diproses",
    operationId: "cancelJob",
    security: apiSecurity,
    params: uuidParams(),
    response: {
      200: {
        type: "object",
        required: ["job"],
        properties: { job: { $ref: "#/components/schemas/Job" } },
      },
      401: errorResponse,
      404: errorResponse,
      409: errorResponse,
    },
  },
  "PATCH /v1/jobs/:id": {
    tags: ["Jobs"],
    summary: "Pindahkan job ke folder",
    operationId: "moveJob",
    security: apiSecurity,
    params: uuidParams(),
    body: {
      type: "object",
      required: ["folderId"],
      additionalProperties: false,
      properties: {
        folderId: {
          anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
          description: "UUID folder atau null untuk melepas dari folder.",
        },
      },
    },
    response: {
      200: {
        type: "object",
        required: ["job"],
        properties: { job: { $ref: "#/components/schemas/Job" } },
      },
      400: errorResponse,
      401: errorResponse,
      404: errorResponse,
    },
  },
  "GET /v1/jobs/:id/pdf": {
    tags: ["Jobs"],
    summary: "Ambil PDF asli",
    operationId: "getJobPdf",
    security: apiSecurity,
    params: uuidParams(),
    querystring: {
      type: "object",
      properties: {
        download: {
          type: "string",
          enum: ["1"],
          description: "Gunakan 1 untuk mengirim file sebagai attachment.",
        },
      },
    },
    produces: ["application/pdf"],
    response: {
      200: { type: "string", format: "binary", description: "File PDF asli." },
      401: errorResponse,
      404: errorResponse,
    },
  },
  "GET /v1/jobs/:id/markdown": {
    tags: ["Jobs"],
    summary: "Ambil hasil Markdown",
    operationId: "getJobMarkdown",
    security: apiSecurity,
    params: uuidParams(),
    querystring: {
      type: "object",
      properties: {
        download: {
          type: "string",
          enum: ["1"],
          description: "Gunakan 1 untuk mengirim file sebagai attachment.",
        },
      },
    },
    produces: ["text/markdown"],
    response: {
      200: { type: "string", description: "Markdown hasil ekstraksi." },
      401: errorResponse,
      404: errorResponse,
      409: errorResponse,
    },
  },
  "DELETE /v1/jobs/:id": {
    tags: ["Jobs"],
    summary: "Hapus job dan seluruh hasilnya",
    operationId: "deleteJob",
    security: apiSecurity,
    params: uuidParams(),
    response: {
      204: { type: "null", description: "Job berhasil dihapus." },
      401: errorResponse,
      404: errorResponse,
      409: errorResponse,
    },
  },
  "GET /v1/jobs/:jobId/ai": {
    tags: ["AI"],
    summary: "Daftar hasil AI untuk satu job",
    operationId: "listJobAiResults",
    security: apiSecurity,
    params: uuidParams("jobId"),
    response: {
      200: {
        type: "object",
        required: ["jobUrl", "aiResultsUrl", "results"],
        properties: {
          jobUrl: { type: "string" },
          aiResultsUrl: { type: "string" },
          results: {
            type: "array",
            items: { $ref: "#/components/schemas/AiResult" },
          },
        },
      },
      401: errorResponse,
      404: errorResponse,
    },
  },
  "GET /v1/jobs/:jobId/ai/:aiId": {
    tags: ["AI"],
    summary: "Ambil satu hasil AI",
    operationId: "getJobAiResult",
    security: apiSecurity,
    params: {
      type: "object",
      required: ["jobId", "aiId"],
      properties: {
        jobId: { type: "string", format: "uuid" },
        aiId: { type: "string", format: "uuid" },
      },
    },
    response: {
      200: {
        type: "object",
        required: ["result"],
        properties: { result: { $ref: "#/components/schemas/AiResult" } },
      },
      401: errorResponse,
      404: errorResponse,
    },
  },
  "POST /v1/jobs/:jobId/ai": {
    tags: ["AI"],
    summary: "Ajukan pertanyaan kepada AI",
    operationId: "createJobAiResult",
    security: apiSecurity,
    params: uuidParams("jobId"),
    body: { $ref: "#/components/schemas/AiPrompt" },
    response: {
      201: {
        type: "object",
        required: ["result"],
        properties: { result: { $ref: "#/components/schemas/AiResult" } },
      },
      400: errorResponse,
      401: errorResponse,
      404: errorResponse,
      409: errorResponse,
    },
  },
};

function methodName(method) {
  return Array.isArray(method) ? method[0] : method;
}

export function openApiOptions() {
  return {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "PDF2AI API",
        description:
          "API untuk mengunggah PDF, memantau ekstraksi Markdown, mengelola folder virtual, dan menjalankan Tanya AI.",
        version: "v1",
      },
      servers: [{ url: "/", description: "Server PDF2AI aktif" }],
      tags: [
        { name: "System", description: "Status service." },
        { name: "Jobs", description: "Upload dan hasil ekstraksi PDF." },
        { name: "Folders", description: "Pengelompokan dokumen secara virtual." },
        { name: "AI", description: "Model dan hasil Tanya AI." },
      ],
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: "apiKey",
            in: "header",
            name: "X-API-Key",
            description: "API key dengan prefix p2ai_ dari dashboard.",
          },
          SessionCookie: {
            type: "apiKey",
            in: "cookie",
            name: "pdf2ai_session",
            description: "Cookie HttpOnly dari login dashboard.",
          },
        },
        schemas: {
          Error: {
            type: "object",
            required: ["error"],
            properties: {
              error: { type: "string" },
              requestId: { type: "string" },
            },
          },
          QueueStats: {
            type: "object",
            required: ["queued", "processing", "completed", "failed", "paused"],
            properties: {
              queued: { type: "integer", minimum: 0 },
              processing: { type: "integer", minimum: 0 },
              completed: { type: "integer", minimum: 0 },
              failed: { type: "integer", minimum: 0 },
              paused: { type: "boolean" },
            },
          },
          Health: {
            type: "object",
            required: ["status", "mode", "hybridReady", "queue"],
            properties: {
              status: { type: "string", enum: ["ok", "not-ready"] },
              mode: { type: "string", enum: ["local", "hybrid"] },
              hybridReady: { type: "boolean" },
              queue: { $ref: "#/components/schemas/QueueStats" },
            },
          },
          FolderInput: {
            type: "object",
            required: ["name"],
            additionalProperties: false,
            properties: { name: { type: "string", minLength: 1, maxLength: 80 } },
          },
          Folder: {
            type: "object",
            required: ["id", "name", "createdAt", "updatedAt", "folderUrl"],
            properties: {
              id: { type: "string", format: "uuid" },
              name: { type: "string" },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
              folderUrl: { type: "string" },
              jobCount: { type: "integer", minimum: 0 },
            },
          },
          FolderCollection: {
            type: "object",
            required: ["foldersUrl", "folders", "unfiledCount", "totalJobCount"],
            properties: {
              foldersUrl: { type: "string" },
              folders: {
                type: "array",
                items: { $ref: "#/components/schemas/Folder" },
              },
              unfiledCount: { type: "integer", minimum: 0 },
              totalJobCount: { type: "integer", minimum: 0 },
            },
          },
          Job: {
            type: "object",
            required: [
              "id",
              "originalName",
              "size",
              "status",
              "createdAt",
              "folderId",
              "jobUrl",
              "pdfUrl",
              "aiModelsUrl",
              "aiResultsUrl",
              "aiResultsCount",
              "hasAiResults",
            ],
            properties: {
              id: { type: "string", format: "uuid" },
              originalName: { type: "string" },
              size: { type: "integer", minimum: 0 },
              status: {
                type: "string",
                enum: ["queued", "processing", "completed", "failed"],
              },
              createdAt: { type: "string", format: "date-time" },
              startedAt: { type: "string", format: "date-time", nullable: true },
              completedAt: { type: "string", format: "date-time", nullable: true },
              error: { type: "string" },
              folderId: { type: "string", format: "uuid", nullable: true },
              folder: {
                allOf: [{ $ref: "#/components/schemas/Folder" }],
                nullable: true,
              },
              folderUrl: { type: "string", nullable: true },
              jobUrl: { type: "string" },
              pdfUrl: { type: "string" },
              markdownUrl: { type: "string", nullable: true },
              aiModelsUrl: { type: "string" },
              aiResultsUrl: { type: "string" },
              aiResultsCount: { type: "integer", minimum: 0 },
              hasAiResults: { type: "boolean" },
            },
          },
          AiModels: {
            type: "object",
            required: ["configured", "modelsUrl", "models", "defaultModel"],
            properties: {
              configured: { type: "boolean" },
              modelsUrl: { type: "string" },
              models: { type: "array", items: { type: "string" } },
              defaultModel: { type: "string", nullable: true },
              updatedAt: { type: "string", format: "date-time", nullable: true },
            },
          },
          AiPrompt: {
            type: "object",
            required: ["model", "message"],
            additionalProperties: false,
            properties: {
              model: { type: "string", minLength: 1, maxLength: 256 },
              message: { type: "string", minLength: 1, maxLength: 20000 },
              templateId: { type: "string", nullable: true, maxLength: 64 },
            },
          },
          AiResult: {
            type: "object",
            required: [
              "id",
              "jobId",
              "originalName",
              "model",
              "prompt",
              "content",
              "createdAt",
              "jobUrl",
              "aiModelsUrl",
              "aiResultsUrl",
              "resultUrl",
            ],
            properties: {
              version: { type: "integer" },
              id: { type: "string", format: "uuid" },
              jobId: { type: "string", format: "uuid" },
              originalName: { type: "string" },
              model: { type: "string" },
              templateId: { type: "string", nullable: true },
              prompt: { type: "string" },
              content: { type: "string" },
              providerId: { type: "string", nullable: true },
              providerModel: { type: "string", nullable: true },
              usage: { type: "object", additionalProperties: true, nullable: true },
              createdAt: { type: "string", format: "date-time" },
              jobUrl: { type: "string" },
              aiModelsUrl: { type: "string" },
              aiResultsUrl: { type: "string" },
              resultUrl: { type: "string" },
            },
          },
        },
      },
    },
    transform: ({ schema, url, route }) => {
      const documented = routeDocumentation[`${methodName(route.method)} ${url}`];
      return {
        schema: documented ? { ...schema, ...documented } : { ...schema, hide: true },
        url,
      };
    },
  };
}
