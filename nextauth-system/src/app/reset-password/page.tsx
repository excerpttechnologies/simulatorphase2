"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validations";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  if (!token) {
    return (
      <AuthCard title="Invalid Link">
        <Alert type="error" message="This reset link is invalid or has expired." />
        <div className="mt-4 text-center">
          <Link href="/forgot-password" className="text-primary-600 hover:underline text-sm font-medium">
            Request a new reset link
          </Link>
        </div>
      </AuthCard>
    );
  }

  const onSubmit = async (data: ResetPasswordInput) => {
    setServerError("");
    try {
      await axios.post("/api/auth/reset-password", { ...data, token });
      setSuccess(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setServerError(err.response?.data?.message || "Failed to reset password");
      } else {
        setServerError("An unexpected error occurred");
      }
    }
  };

  return (
    <AuthCard
      title="Reset password"
      subtitle="Enter your new password below"
    >
      {success ? (
        <div className="space-y-4 text-center">
          <Alert type="success" message="Password reset successfully! Redirecting to login..." />
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {serverError && <Alert type="error" message={serverError} />}

          <Input
            label="New password"
            type="password"
            placeholder="Min 8 chars, 1 uppercase, 1 number"
            autoComplete="new-password"
            error={errors.password?.message}
            {...register("password")}
          />

          <Input
            label="Confirm new password"
            type="password"
            placeholder="Repeat your new password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register("confirmPassword")}
          />

          <Button type="submit" isLoading={isSubmitting} className="w-full py-2.5">
            Reset password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
