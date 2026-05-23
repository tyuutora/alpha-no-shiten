<?php
/**
 * Plugin Name: Alpha no Shiten REST SEO Meta
 * Description: Allows authenticated REST API draft updates to store Rank Math SEO fields used by alpha-no-shiten.
 * Version: 1.0.0
 * Author: Alpha no Shiten
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'init',
	function () {
		$meta_keys = array(
			'rank_math_title',
			'rank_math_description',
			'rank_math_focus_keyword',
		);

		foreach ( $meta_keys as $meta_key ) {
			register_post_meta(
				'post',
				$meta_key,
				array(
					'type'              => 'string',
					'single'            => true,
					'show_in_rest'      => true,
					'sanitize_callback' => 'sanitize_text_field',
					'auth_callback'     => function () {
						return current_user_can( 'edit_posts' );
					},
				)
			);
		}
	}
);
