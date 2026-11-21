import { unprocessableEntity } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { isDemoMode } from "@server/config/demo";
import {
  generateJobCoverLetter,
  previewRecruiterEmail,
  saveJobCoverLetterForJob,
  sendRecruiterEmail,
} from "@server/services/post-application/recruiter-email";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { toJobsRouteError } from "./shared";

export const jobsRecruiterEmailRouter = Router();

const previewRequestSchema = z.object({
  messageId: z.string().min(1).nullable().optional(),
});

const saveCoverLetterSchema = z.object({
  coverLetter: z.string().max(20_000),
});

const sendRequestSchema = z.object({
  previewToken: z.string().min(1).max(200),
  to: z.string().max(254).optional(),
  subject: z.string().max(200).optional(),
  body: z.string().max(20000).optional(),
});

jobsRecruiterEmailRouter.post(
  "/:id/email/preview",
  async (req: Request, res: Response) => {
    try {
      const input = previewRequestSchema.parse(req.body ?? {});
      const preview = await previewRecruiterEmail({
        jobId: req.params.id,
        messageId: input.messageId ?? null,
      });
      ok(res, preview);
    } catch (error) {
      const err = toJobsRouteError(error, {
        invalidRequestFallbackMessage: "Invalid email preview request",
      });
      logger.error("Recruiter email preview route failed", {
        route: "POST /api/jobs/:id/email/preview",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
      });
      fail(res, err);
    }
  },
);

jobsRecruiterEmailRouter.post(
  "/:id/cover-letter",
  async (req: Request, res: Response) => {
    try {
      const result = await generateJobCoverLetter({ jobId: req.params.id });
      ok(res, result);
    } catch (error) {
      const err = toJobsRouteError(error, {
        invalidRequestFallbackMessage: "Invalid cover letter request",
      });
      logger.error("Job cover letter route failed", {
        route: "POST /api/jobs/:id/cover-letter",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
      });
      fail(res, err);
    }
  },
);

jobsRecruiterEmailRouter.put(
  "/:id/cover-letter",
  async (req: Request, res: Response) => {
    try {
      const input = saveCoverLetterSchema.parse(req.body ?? {});
      const result = await saveJobCoverLetterForJob({
        jobId: req.params.id,
        coverLetter: input.coverLetter.trim() ? input.coverLetter : null,
      });
      ok(res, result);
    } catch (error) {
      const err = toJobsRouteError(error, {
        invalidRequestFallbackMessage: "Invalid cover letter save request",
      });
      logger.error("Save job cover letter route failed", {
        route: "PUT /api/jobs/:id/cover-letter",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
      });
      fail(res, err);
    }
  },
);

jobsRecruiterEmailRouter.post(
  "/:id/email/send",
  async (req: Request, res: Response) => {
    try {
      if (isDemoMode()) {
        throw unprocessableEntity(
          "Sending emails is not available in demo mode.",
        );
      }

      const input = sendRequestSchema.parse(req.body);
      const result = await sendRecruiterEmail({
        jobId: req.params.id,
        request: input,
      });
      ok(res, result, 202);
    } catch (error) {
      const err = toJobsRouteError(error, {
        invalidRequestFallbackMessage: "Invalid email send request",
      });
      logger.error("Recruiter email send route failed", {
        route: "POST /api/jobs/:id/email/send",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
      });
      fail(res, err);
    }
  },
);
