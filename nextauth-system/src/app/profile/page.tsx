"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import { changePasswordSchema, type ChangePasswordInput } from "@/lib/validations";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

export default function ProfilePage() {
  const [pwSuccess, setPwSuccess] = useState("");
  const [pwError, setPwError] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });

  const onChangePassword = async (data: ChangePasswordInput) => {
    setPwError(""); setPwSuccess("");
    try {
      await axios.post("/api/auth/change-password", data);
      setPwSuccess("Password changed successfully!");
      reset();
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setPwError(err.response?.data?.message || "Failed to change password");
      } else {
        setPwError("An unexpected error occurred");
      }
    }
  };

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Profile Settings</h1>
      <p className="text-slate-500 dark:text-slate-400 mb-8">Manage your account security.</p>

      {/* Change Password */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Change Password</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
          Use a strong password with at least 8 characters.
        </p>

        <form onSubmit={handleSubmit(onChangePassword)} className="space-y-4">
          {pwSuccess && <Alert type="success" message={pwSuccess} />}
          {pwError   && <Alert type="error"   message={pwError} />}

          <Input
            label="Current password"
            type="password"
            placeholder="Your current password"
            error={errors.currentPassword?.message}
            {...register("currentPassword")}
          />
          <Input
            label="New password"
            type="password"
            placeholder="Min 8 chars, 1 uppercase, 1 number"
            error={errors.newPassword?.message}
            {...register("newPassword")}
          />
          <Input
            label="Confirm new password"
            type="password"
            placeholder="Repeat new password"
            error={errors.confirmPassword?.message}
            {...register("confirmPassword")}
          />

          <Button type="submit" isLoading={isSubmitting} className="mt-2">
            Update password
          </Button>
        </form>
      </div>
    </div>
  );
}
