
    /* =================================================================================
       JAVASCRIPT
       =================================================================================
       Minimal vanilla JavaScript for interactivity:
       1. Mobile menu toggle (open/close overlay)
       2. Shopping cart counter increment
       3. Newsletter form handler
       =================================================================================  */
  
    /**
     * Toggles the mobile navigation overlay.
     * Adds/removes the "active" class on the mobile menu element
     * and prevents body scrolling when menu is open.
     */
    function toggleMenu() {
      const menu = document.getElementById('mobileMenu');
      const isOpen = menu.classList.toggle('active');
      document.body.classList.toggle('menu-open', isOpen);
    }

    /**
     * Simulates adding an item to the shopping cart.
     * Reads the current badge number, increments it, and updates the DOM.
     * In a real app, this would sync with a backend cart API.
     */
    let cartCount = 2; // Starting value matches the UI badge
    function addToCart() {
      cartCount++;
      const badge = document.getElementById('cartBadge');
      badge.textContent = cartCount;

      // Visual feedback: brief scale pulse on the badge
      badge.style.transform = 'scale(1.3)';
      setTimeout(() => {
        badge.style.transform = 'scale(1)';
      }, 200);
    }

    /**
     * Handles newsletter form submission.
     * Prevents default page reload, shows a simple alert,
     * and resets the input field.
     */
    function handleSubscribe(event) {
      event.preventDefault(); // Stop the form from actually submitting/reloading
      const input = event.target.querySelector('input');
      const email = input.value.trim();

      if (email) {
        alert('Thanks for subscribing! Check your inbox for a confirmation email.');
        input.value = ''; // Clear the input after successful "submission"
      }
    }

    /**
     * Optional: Close mobile menu when clicking outside nav links
     * (improves UX on devices where the overlay might feel "stuck")
     */
    document.getElementById('mobileMenu').addEventListener('click', function(e) {
      if (e.target === this) {
        toggleMenu();
      }
    });

