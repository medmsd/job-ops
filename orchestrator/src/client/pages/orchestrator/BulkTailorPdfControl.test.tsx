import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BulkTailorPdfControl } from "./BulkTailorPdfControl";

describe("BulkTailorPdfControl", () => {
  it("submits the entered limit", () => {
    const onProcess = vi.fn();
    render(
      <BulkTailorPdfControl
        jobCount={40}
        inFlight={false}
        onProcess={onProcess}
      />,
    );

    const input = screen.getByLabelText("Number of discovered jobs to tailor");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(
      screen.getByRole("button", { name: /tailor & generate pdf/i }),
    );

    expect(onProcess).toHaveBeenCalledWith(12);
  });

  it("clamps the limit on blur", () => {
    render(
      <BulkTailorPdfControl
        jobCount={40}
        inFlight={false}
        onProcess={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Number of discovered jobs to tailor");
    fireEvent.change(input, { target: { value: "900" } });
    fireEvent.blur(input);

    expect(input).toHaveValue(500);
  });

  it("is disabled with no jobs or while an action is in flight", () => {
    const { rerender } = render(
      <BulkTailorPdfControl
        jobCount={0}
        inFlight={false}
        onProcess={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /tailor & generate pdf/i }),
    ).toBeDisabled();

    rerender(
      <BulkTailorPdfControl
        jobCount={40}
        inFlight={true}
        onProcess={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /tailor & generate pdf/i }),
    ).toBeDisabled();
  });
});
