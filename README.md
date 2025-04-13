# navajitd.github.io

A simple, elegant personal website template that can be hosted on GitHub Pages.

## Features

- Clean, responsive design
- Projects showcase section
- About me section
- Contact form
- Social media links
- Smooth scrolling navigation

## How to Use This Template

### Setting Up GitHub Pages

1. **Create a new repository**
   - Go to GitHub and create a new repository named `yourusername.github.io` (replace "yourusername" with your actual GitHub username)
   - This special repository name tells GitHub to publish your site at `https://yourusername.github.io`

2. **Clone the repository to your local machine**
   ```bash
   git clone https://github.com/yourusername/yourusername.github.io.git
   cd yourusername/yourusername.github.io
   ```

3. **Add the website files**
   - Copy the `index.html` file into the repository folder
   - Add any images to an `images` folder
   
4. **Commit and push your changes**
   ```bash
   git add .
   git commit -m "Initial website setup"
   git push -u origin main
   ```

5. **Wait for GitHub Pages to build your site**
   - Go to your repository settings
   - Scroll down to the "GitHub Pages" section
   - Ensure the source is set to your main branch
   - Your site should be published at `https://yourusername.github.io` within a few minutes

### Customizing Your Website

1. **Replace placeholder text**
   - Open `index.html` and replace "Your Name", "Your City", and other placeholder text with your information
   
2. **Add your own images**
   - Create an `images` folder in your repository
   - Add your photos, project screenshots, and other images
   - Update the HTML to reference your images

3. **Customize colors**
   - In the CSS section at the top of the HTML file, modify the color variables in the `:root` selector to match your preferred color scheme

4. **Add real project information**
   - Update the project cards with your actual projects
   - Link to your project repositories or live demos

5. **Set up the contact form**
   - The template includes a basic contact form that needs to be connected to a form handling service
   - You can use services like Formspree, Netlify Forms, or a custom backend for form submission

6. **Add your social media links**
   - Update the social links in the footer with your actual social media profiles

## Adding a Custom Domain (Optional)

If you want to use a custom domain instead of `yourusername.github.io`:

1. Purchase a domain from a domain registrar (like Namecheap, GoDaddy, Google Domains, etc.)
2. In your GitHub repository, go to Settings > Pages
3. Under "Custom domain", enter your domain name and save
4. Configure your domain's DNS settings according to GitHub's instructions
5. Create a file named `CNAME` in your repository with your domain name on a single line

## Resources

- [GitHub Pages Documentation](https://docs.github.com/en/pages)
- [Setting up a custom domain with GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)
- [HTML/CSS tutorials on MDN](https://developer.mozilla.org/en-US/docs/Web/Tutorials)
