const form = document.querySelector("#login-form");
const code = document.querySelector("#code");
const button = document.querySelector("#login-button");
const buttonLabel = document.querySelector("#login-button-label");
const errorMessage = document.querySelector("#login-error");

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
        code: code.value.replace(/\D/g, ""),
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
  code.value = code.value.replace(/\D/g, "").slice(0, 6);
});
