-- CreateTable
CREATE TABLE "job_state" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_state_pkey" PRIMARY KEY ("name")
);
