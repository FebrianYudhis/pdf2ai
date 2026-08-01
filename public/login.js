const form = document.querySelector("#login-form");
const code = document.querySelector("#code");
const button = document.querySelector("#login-button");
const buttonLabel = document.querySelector("#login-button-label");
const errorMessage = document.querySelector("#login-error");

function totpDigits(value) {
  return String(value).replace(/\D/g, "").slice(0, 6);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  buttonLabel.textContent = "Memeriksa…";
  errorMessage.hidden = true;

  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: totpDigits(code.value),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Tidak dapat masuk.");
    }
    window.location.replace("/");
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
    code.select();
  } finally {
    button.disabled = false;
    buttonLabel.textContent = "Masuk ke PDF2AI";
  }
});

code.addEventListener("input", () => {
  code.value = totpDigits(code.value);
});

code.addEventListener("paste", (event) => {
  const pastedCode = totpDigits(event.clipboardData?.getData("text") ?? "");
  if (!pastedCode) {
    return;
  }
  event.preventDefault();
  code.value = pastedCode;
  code.setSelectionRange(code.value.length, code.value.length);
});
