// ============================================
// CONFIG
// ============================================
// GitHub Pages only serves static files — there's no server to receive
// form submissions. To actually collect emails, sign up for a free
// form endpoint (Formspree, Getform, or a Google Form) and paste the
// endpoint URL below. Until you do, submissions are just validated and
// shown as a success message, but not sent anywhere.
//
// Formspree example: https://formspree.io/f/xxxxxxx
const FORM_ENDPOINT = ""; // <-- paste your form endpoint URL here

const form = document.getElementById("notify-form");
const status = document.getElementById("form-status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = form.name.value.trim();
  const email = form.email.value.trim();

  if (!name) {
    showStatus("Add your name so we know who's coming.", "error");
    form.name.focus();
    return;
  }

  if (!isValidEmail(email)) {
    showStatus("That email doesn't look right — double check it.", "error");
    form.email.focus();
    return;
  }

  const submitBtn = form.querySelector(".submit-btn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";

  const payload = {
    name,
    email,
    guests: form.guests.value || "unspecified",
  };

  try {
    if (FORM_ENDPOINT) {
      const response = await fetch(FORM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error("Submission failed");
    }

    showStatus(`Thanks, ${name.split(" ")[0]} — we'll be in touch soon.`, "success");
    form.reset();
  } catch (err) {
    showStatus("Something went wrong sending that. Try again in a moment.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Notify me";
  }
});

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function showStatus(message, type) {
  status.textContent = message;
  status.className = `form-status ${type}`;
}
